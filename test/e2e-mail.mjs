// End to end, on this machine: installs the kit into a throwaway project, runs the mail
// Worker there with `wrangler dev` and its local database, and takes a desk through what
// it does with mail. The desk hears an email, sends an approved reply, can't send it
// twice, finds it in the thread, and is refused a reply to an email its sender has
// written again since. Nothing leaves the machine: wrangler dev only simulates sends.
//
//   pnpm e2e            (node test/e2e-mail.mjs --keep leaves the project behind)
//
// The first run downloads wrangler through npx.

import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const keep = process.argv.includes('--keep');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'desk-e2e-'));
const desks = path.join(dir, 'desks');
const mailDir = path.join(desks, 'mail');
const log = path.join(dir, 'wrangler.log');
// What the desk sees comes from desks/.env, not from whoever runs this, and wrangler gets
// no Cloudflare credentials, so it can't reach an account.
const env = {
  ...Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(DESK_|CLOUDFLARE_|CF_)/.test(k))),
  WRANGLER_SEND_METRICS: 'false', CI: 'true',
};
const children = [];

const ok = (what) => console.log(`ok - ${what}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function run(cmd, args, { cwd = dir, input } = {}) {
  const r = spawnSync(cmd, args, { cwd, env, input, encoding: 'utf8' });
  if (r.error) throw r.error;
  return { code: r.status, out: r.stdout, err: r.stderr };
}
const desk = (args, opts) => run(process.execPath, ['desks/desk.mjs', ...args], opts);
const must = (r, what) => { assert.equal(r.code, 0, `${what}:\n${r.err}${r.out}`); return r.out; };
const WRANGLER = ['-y', 'wrangler@latest'];

// The rows of the last statement that has any.
function sql(text, args = {}) {
  const a = Object.entries(args).flatMap(([k, v]) => ['-a', `${k}=${v}`]);
  const out = JSON.parse(must(desk(['sql', '--json', ...a, '-'], { input: text }), 'sql'));
  return out.filter((s) => s.rows).at(-1)?.rows ?? out;
}

// Waits for ready() while the child runs, for up to ms.
async function until(child, ready, ms, what) {
  for (const end = Date.now() + ms; !(await ready()); await sleep(100)) {
    if (child.exitCode !== null) throw new Error(`${what} stopped before it was ready`);
    if (Date.now() > end) throw new Error(`${what} wasn't ready within ${ms / 1000}s`);
  }
}

async function freePort() {
  const s = net.createServer().listen(0, '127.0.0.1');
  await new Promise((r) => s.once('listening', r));
  const { port } = s.address();
  await new Promise((r) => s.close(r));
  return port;
}

// Starts a command in its own process group, so stopping it stops what it started, even
// after the command itself has gone (npx leaves wrangler and workerd).
function start(cmd, args, opts) {
  const child = spawn(cmd, args, { env, detached: true, ...opts });
  children.push(child);
  child.done = new Promise((r) => child.once('exit', (code) => r(code)));
  return child;
}
const signal = (sig) => { for (const c of children) try { process.kill(-c.pid, sig); } catch {} };
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.once(sig, () => {
    signal('SIGKILL');
    console.error(`\nStopped. The project is in ${dir}`);
    process.exit(130);
  });
}

function email({ id, subject, text, replyTo, at }) {
  return [
    'From: Jo Bloggs <jo@acme.com>', 'To: clara@seo.test', `Subject: ${subject}`, `Message-ID: <${id}@acme.com>`,
    ...(replyTo ? [`In-Reply-To: <${replyTo}@acme.com>`, `References: <${replyTo}@acme.com>`] : []),
    `Date: ${at.toUTCString()}`, 'Content-Type: text/plain; charset=utf-8', '', text, '',
  ].join('\r\n');
}

async function main() {
  // The project, with the kit and one desk that has an address.
  must(run('git', ['init', '-q']), 'git init');
  must(run(process.execPath, [path.join(REPO, 'bin/kit.mjs'), dir]), 'kit install');
  let settings = fs.readFileSync(path.join(desks, 'kit/mail/wrangler.example.jsonc'), 'utf8');
  const yours = [
    ['example-mail', 'e2e-mail'],
    ['desk@mail.example.com', 'clara@seo.test'],
    ['Desk at Example', 'Clara'],
    ['you@example.com', 'owner@person.test'],
  ];
  for (const [from, to] of yours) {
    assert.ok(settings.includes(from), `wrangler.example.jsonc has no ${from} to replace`);
    settings = settings.replaceAll(from, to);
  }
  fs.mkdirSync(mailDir, { recursive: true });
  fs.writeFileSync(path.join(mailDir, 'wrangler.jsonc'), settings);
  const token = randomBytes(32).toString('hex');
  const port = await freePort();
  const url = `http://127.0.0.1:${port}`;
  fs.writeFileSync(path.join(mailDir, '.dev.vars'), `MAIL_API_TOKEN=${token}\n`);
  fs.writeFileSync(path.join(desks, '.env'), `DESK_USER=e2e\nDESK_MAIL_URL=${url}\nDESK_MAIL_TOKEN=${token}\n`);
  fs.mkdirSync(path.join(desks, 'seo/migrations'), { recursive: true });
  fs.writeFileSync(path.join(desks, 'seo/desk.md'), `# SEO desk
Headline: clicks-7d
Target: 100 a week
Mail: clara@seo.test

## Purpose
An end-to-end check.
`);
  must(desk(['init']), 'init');
  ok(`kit installed in ${dir}, with a desk that answers clara@seo.test`);

  // The Worker, on this machine.
  must(run('npx', [...WRANGLER, 'd1', 'migrations', 'apply', 'e2e-mail', '--local'], { cwd: mailDir }), 'migrations');
  const logFd = fs.openSync(log, 'w');
  const worker = start('npx', [...WRANGLER, 'dev', '--port', String(port), '--ip', '127.0.0.1'], {
    cwd: mailDir, stdio: ['ignore', logFd, logFd],
  });
  fs.closeSync(logFd);
  const health = () => fetch(`${url}/health`, { signal: AbortSignal.timeout(2000) }).then((r) => r.ok, () => false);
  await until(worker, health, 120000, 'wrangler dev');
  ok(`the mail Worker answers at ${url}`);

  // doctor checks the Worker with the token, and that git ignores the token, the settings
  // and the database; wrangler's local state is checked here.
  must(desk(['doctor']), 'doctor');
  must(run('git', ['check-ignore', '-q', 'desks/mail/.wrangler']), 'desks/mail/.wrangler is not ignored by git');
  ok('doctor is happy, and git ignores the token, wrangler\'s local state and the database');

  // Mail in: watch hears it.
  const watch = start(process.execPath, ['desks/desk.mjs', 'watch', 'seo', '--every', '1s', '--max', '1m'], {
    cwd: dir, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let heard = '', said = '';
  watch.stdout.on('data', (d) => { heard += d; });
  watch.stderr.on('data', (d) => { said += d; });
  await until(watch, () => said.includes('Listening for seo:'), 10000, 'watch').catch((e) => { throw new Error(`${e.message}:\n${said}`); });
  const deliver = async (raw) => {
    const r = await fetch(`${url}/cdn-cgi/handler/email?from=jo@acme.com&to=clara@seo.test`, { method: 'POST', body: raw });
    assert.ok(r.ok, `the Worker refused the email: ${r.status} ${await r.text()}`);
  };
  const sent = new Date();
  await deliver(email({ id: 'jo-1', subject: 'Terms?', text: 'Hi Clara, what are your terms?\nJo', at: sent }));
  assert.equal(await watch.done, 0, said);
  const wake = heard.trim().match(/^mail (mail:clara@seo\.test:[\w-]+) from jo@acme\.com to clara@seo\.test$/);
  assert.ok(wake, `watch printed:\n${heard}`);
  const jo1 = wake[1];
  ok(`watch woke for Jo's email: ${heard.trim()}`);

  // Mail out: an approved reply goes once, and is in the thread.
  const approved = (key) => sql(`
    INSERT INTO actions(desk, key, kind, channel, identity, about, target, title, body, payload, status, created_by)
      VALUES ('seo', :key, 'email-reply', 'email', 'clara@seo.test', 'brand:acme', 'email:jo@acme.com',
        'Re: Terms?', :body, json_object('reply_to', :reply), 'waiting', 'e2e');
    UPDATE actions SET status = 'approved', approved_by = 'e2e', approved_version = 1, last_by = 'e2e' WHERE key = :key;
    SELECT id FROM actions WHERE key = :key;`, { key, body: 'Hi Jo,\n\n10% works for us.\n\nClara', reply: jo1 })[0].id;
  const id = approved('e2e:reply-1');
  const out = must(desk(['send', String(id)]), 'send');
  const ref = out.match(/^Sent #\d+ to jo@acme\.com as clara@seo\.test: recorded as sent \((mail:[\w-]+)\)/)?.[1];
  assert.ok(ref, out);
  const [row] = sql('SELECT status, provider_ref FROM actions WHERE id = :id', { id });
  assert.deepEqual(row, { status: 'sent', provider_ref: ref });
  ok(`send sent #${id} and recorded it as ${ref}`);

  const again = desk(['send', String(id)]);
  assert.equal(again.code, 1);
  assert.match(again.err, /was sent already/);
  ok('a second send of the same action is refused');

  assert.match(must(desk(['mail', 'sent', '--key', 'e2e:reply-1']), 'mail sent'), /Re: Terms\?/);
  const thread = must(desk(['mail', 'thread', ref]), 'mail thread');
  assert.match(thread, /^Thread \S+: Terms\?, 2 emails/, thread);
  ok('the reply is in mail sent and in the thread, opened from its recorded id');

  // Jo writes again before the next reply goes: that reply is stale.
  const later = new Date(sent.getTime() + 60000);
  await deliver(email({ id: 'jo-2', subject: 'Re: Terms?', text: 'Actually, one more thing.\nJo', replyTo: 'jo-1', at: later }));
  const late = approved('e2e:reply-2');
  const stale = desk(['send', String(late)]);
  assert.equal(stale.code, 1, stale.out);
  assert.match(stale.err, /wrote again/);
  assert.equal(sql('SELECT status FROM actions WHERE id = :id', { id: late })[0].status, 'approved');
  ok('a reply to an email Jo has written again since is refused, and stays approved');
}

let failed = false;
try {
  await main();
  console.log('\nAll good.');
} catch (e) {
  failed = true;
  console.error(`\nnot ok - ${e.message}`);
  if (fs.existsSync(log)) {
    const last = fs.readFileSync(log, 'utf8').trim().split('\n').slice(-25);
    console.error(`\nwrangler's last lines:\n${last.join('\n')}`);
  }
} finally {
  signal('SIGTERM');
  await Promise.all(children.map((c) => Promise.race([c.done, sleep(5000)])));
  signal('SIGKILL');
  if (keep || failed) console.error(`\nThe project is in ${dir}`);
  else fs.rmSync(dir, { recursive: true, force: true });
}
process.exit(failed ? 1 : 0);
