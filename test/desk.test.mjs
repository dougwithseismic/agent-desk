// Tests for the desk script and core schema. Every test runs the real script in a
// throwaway project, the way an agent or a person would.
//
//   node --test test/desk.test.mjs         against a local SQLite file
//   DESK_TEST_URL=https://... DESK_TEST_TOKEN=... node --test test/desk.test.mjs
//                                          against a hosted libsql server. Use an empty
//                                          database kept for tests: it is wiped before each test.

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { splitSql, authHeader } from '../template/desks/desk.mjs';

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../template/desks');
const HOSTED = process.env.DESK_TEST_URL;
const TOKEN = process.env.DESK_TEST_TOKEN;
const dirs = [];
after(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });

const q = (s) => (s === null ? 'NULL' : `'${String(s).replace(/'/g, "''")}'`);

function run(cwd, args, { user = 'doug', input, env = {} } = {}) {
  const base = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('DESK_')));
  const full = {
    ...base,
    ...(user ? { DESK_USER: user } : {}),
    ...(HOSTED ? { DESK_DB: HOSTED, DESK_DB_TOKEN: TOKEN } : {}),
    ...env,
  };
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ['desks/desk.mjs', ...args], { cwd, env: full });
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    child.on('close', (code) => resolve({ code, out, err }));
    child.stdin.end(input ?? '');
  });
}

async function wipeHosted(dir) {
  const list = await run(dir, ['sql', '--json', "SELECT type, name FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%' AND name NOT LIKE 'libsql_%'"]);
  assert.equal(list.code, 0, list.err);
  const objects = JSON.parse(list.out);
  if (objects.length && !objects.some((o) => o.name === 'desk_test_marker')) {
    throw new Error('DESK_TEST_URL has data in it and is not a test database: point it at an empty one');
  }
  const order = { trigger: 0, view: 1, table: 2 };
  const drops = objects.filter((o) => o.type in order).sort((a, b) => order[a.type] - order[b.type])
    .map((o) => `DROP ${o.type.toUpperCase()} IF EXISTS "${o.name}";`);
  const r = await run(dir, ['sql', '-'], { input: `PRAGMA foreign_keys = OFF;\n${drops.join('\n')}\nCREATE TABLE desk_test_marker(x);` });
  assert.equal(r.code, 0, r.err);
}

// A project with desks/ from the kit and one folder per desk.
async function project(desks = { seo: {} }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'desk-test-'));
  dirs.push(dir);
  fs.cpSync(KIT, path.join(dir, 'desks'), { recursive: true });
  for (const [name, d] of Object.entries(desks)) {
    fs.mkdirSync(path.join(dir, 'desks', name, 'migrations'), { recursive: true });
    const head = [`# ${name} test desk`, `Headline: ${d.headline ?? 'clicks-7d'}`, 'Target: 100 a week'];
    if (d.needs) head.push(`Needs: ${d.needs}`);
    fs.writeFileSync(path.join(dir, 'desks', name, 'desk.md'), `${head.join('\n')}\n\n## Purpose\nTesting.\n`);
    if (d.schema) fs.writeFileSync(path.join(dir, 'desks', name, 'schema.sql'), d.schema);
  }
  const p = {
    dir,
    run: (args, opts) => run(dir, args, opts),
    // Run SQL and return the rows of the last statement that has any.
    async sql(text, { user, args = {} } = {}) {
      const a = Object.entries(args).flatMap(([k, v]) => ['-a', `${k}=${v}`]);
      const r = await run(dir, ['sql', '--json', ...a, '-'], { user, input: text });
      if (r.code !== 0) throw new Error(r.err.trim());
      const out = r.out.trim() ? JSON.parse(r.out) : [];
      if (!out.length || !('statement' in out[0])) return out;
      const withRows = out.filter((s) => s.rows);
      return withRows.length ? withRows.at(-1).rows : out;
    },
    async fails(text, pattern, opts) {
      await assert.rejects(p.sql(text, opts), pattern);
    },
    async one(text, opts) {
      const rows = await p.sql(text, opts);
      return rows[0];
    },
  };
  if (HOSTED) await wipeHosted(dir);
  const init = await p.run(['init']);
  assert.equal(init.code, 0, init.err);
  return p;
}

function newAction(o = {}) {
  const a = {
    desk: 'seo', kind: 'email-reply', channel: 'email', identity: 'doug@x.com', about: 'brand:acme',
    target: 'email:jo@acme.com', title: 'Hello', body: 'Hi Jo', payload: '{}', status: 'waiting', by: 'doug', ...o,
  };
  a.key ??= `test:${Math.random().toString(36).slice(2)}`;
  return `INSERT INTO actions(desk, key, kind, channel, identity, about, target, title, body, payload, status, created_by)
    VALUES (${[a.desk, a.key, a.kind, a.channel, a.identity, a.about, a.target, a.title, a.body, a.payload, a.status, a.by].map(q).join(', ')})
    RETURNING id;`;
}
const approve = (id, version = 1, by = 'doug') =>
  `UPDATE actions SET status = 'approved', approved_by = ${q(by)}, approved_version = ${version}, last_by = ${q(by)} WHERE id = ${id};`;
const claim = (id, mode = 'human', by = 'doug') =>
  `UPDATE actions SET status = 'sending', mode = '${mode}', sent_by = ${q(by)}, last_by = ${q(by)} WHERE id = ${id};`;
const land = (id) => `UPDATE actions SET status = 'sent', provider_ref = 'ref-${id}' WHERE id = ${id};
  UPDATE actions SET status = 'verified', result = 'delivered' WHERE id = ${id};`;
const humanSend = (id, version = 1) => `${approve(id, version)}\n${claim(id)}\n${land(id)}`;

async function create(p, o) {
  return (await p.one(newAction(o))).id;
}
async function trustRow(p, kind = 'email-reply') {
  return p.one(`SELECT * FROM trust WHERE desk = 'seo' AND kind = ${q(kind)}`);
}

// ---------- the script ----------

test('splitting SQL keeps trigger bodies, strings and comments whole', () => {
  const core = fs.readFileSync(path.join(KIT, 'kit/core.sql'), 'utf8');
  const stmts = splitSql(core);
  const triggers = stmts.filter((s) => /^CREATE TRIGGER/i.test(s.sql.replace(/^(--.*\n|\s)+/, '')));
  assert.ok(triggers.length >= 15);
  for (const t of triggers) assert.match(t.sql, /END$/, t.sql.slice(0, 80));
  assert.ok(stmts.every((s) => s.params.length === 0), 'core.sql takes no parameters');

  const s = splitSql("SELECT ';' AS a, :x -- :not\n; SELECT 'it''s', @y /* :no; */; ;");
  assert.equal(s.length, 2);
  assert.deepEqual(s[0].params, [':x']);
  assert.deepEqual(s[1].params, ['@y']);
  assert.equal(s[0].first, 'SELECT');
});

test('a JWT goes as Bearer and a plain secret as Basic', () => {
  assert.equal(authHeader('eyJh.eyJh.sig'), 'Bearer eyJh.eyJh.sig');
  assert.equal(authHeader('Ab3dEf9'), 'Basic Ab3dEf9');
});

test('init is safe to repeat and sets up the core and each desk', async () => {
  const p = await project({ seo: { schema: 'CREATE TABLE IF NOT EXISTS seo_pages (path TEXT PRIMARY KEY, clicks INTEGER);' } });
  const again = await p.run(['init']);
  assert.equal(again.code, 0, again.err);
  assert.match(again.out, /Desks: seo\./);
  const names = (await p.sql('SELECT name FROM migrations ORDER BY name')).map((r) => r.name);
  assert.deepEqual(names, ['core/core.sql', 'seo/schema.sql']);
  assert.deepEqual(await p.sql("INSERT INTO seo_pages VALUES ('/x', 3); SELECT * FROM seo_pages"), [{ path: '/x', clicks: 3 }]);
  const desk = await p.one('SELECT * FROM desks');
  assert.equal(desk.headline, 'clicks-7d');
  assert.equal(desk.target, '100 a week');
  if (!HOSTED) {
    assert.equal(fs.statSync(path.join(p.dir, 'desks/data/desk.db')).mode & 0o777, 0o600);
    assert.match(fs.readFileSync(path.join(p.dir, 'desks/.gitignore'), 'utf8'), /^data$/m);
  }
});

test('a desk migration runs once, in order', async () => {
  const p = await project({ seo: { schema: 'CREATE TABLE IF NOT EXISTS seo_pages (path TEXT PRIMARY KEY);' } });
  fs.writeFileSync(path.join(p.dir, 'desks/seo/migrations/001-title.sql'), 'ALTER TABLE seo_pages ADD COLUMN title TEXT;');
  fs.writeFileSync(path.join(p.dir, 'desks/seo/migrations/002-h1.sql'), 'ALTER TABLE seo_pages ADD COLUMN h1 TEXT;');
  for (let i = 0; i < 2; i++) {
    const r = await p.run(['init']);
    assert.equal(r.code, 0, r.err);
  }
  const cols = (await p.sql("SELECT name FROM pragma_table_info('seo_pages')")).map((r) => r.name);
  assert.deepEqual(cols, ['path', 'title', 'h1']);
});

test('a failing statement saves nothing from the same run', async () => {
  const p = await project();
  await p.fails(`INSERT INTO tasks(desk, what, created_by) VALUES ('seo', 'first', :me);
    INSERT INTO tasks(desk, what, created_by, status) VALUES ('seo', 'second', :me, 'nonsense');`, /CHECK constraint failed.*statement 2.*Nothing was saved/s);
  assert.equal((await p.one('SELECT count(*) AS n FROM tasks')).n, 0);
});

test('long text goes in from a file exactly, with no escaping', async () => {
  const p = await project();
  const text = "Hi Jo,\n\nIt's \"quoted\", has $HOME, `ticks`, a ; and -- this.\n\nDoug\n";
  const file = path.join(p.dir, 'body.txt');
  fs.writeFileSync(file, text);
  const id = (await p.one(newAction({ body: 'placeholder' }))).id;
  await p.sql(`UPDATE actions SET body = :body WHERE id = ${id}`, { args: { body: `@${file}` } });
  assert.equal((await p.one(`SELECT body FROM actions WHERE id = ${id}`)).body, text);
});

test('using :me without DESK_USER says how to fix it', async () => {
  const p = await project();
  const r = await p.run(['sql', "SELECT :me"], { user: null });
  assert.equal(r.code, 1);
  assert.match(r.err, /DESK_USER/);
});

test('doctor says what to fix', async () => {
  const p = await project({ seo: { needs: 'DESK_TEST_NEEDED_THING' } });
  const bad = await p.run(['doctor'], { user: null });
  assert.equal(bad.code, 1);
  assert.match(bad.out, /DESK_USER is not set/);
  assert.match(bad.out, /seo needs DESK_TEST_NEEDED_THING/);
  const good = await p.run(['doctor'], { env: { DESK_TEST_NEEDED_THING: 'x' } });
  assert.equal(good.code, 0, good.out);
  assert.match(good.out, /All good/);
  fs.appendFileSync(path.join(p.dir, 'desks/kit/core.sql'), '\n-- changed\n');
  assert.match((await p.run(['doctor'], { env: { DESK_TEST_NEEDED_THING: 'x' } })).out, /kit changed since the last init/);
});

test('a git worktree works on the main checkout\'s database and settings', { skip: HOSTED && 'a local file only' }, async () => {
  const p = await project();
  const git = (...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd: p.dir, stdio: 'ignore' });
  git('init', '-q');
  git('add', '-A');
  git('commit', '-q', '-m', 'desks');
  const wt = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'desk-wt-')), 'wt');
  dirs.push(path.dirname(wt));
  git('worktree', 'add', '-q', wt);
  fs.writeFileSync(path.join(p.dir, 'desks/.env'), 'DESK_USER=sam\n');

  const r = await run(wt, ['sql', '--json', "INSERT INTO tasks(desk, what, created_by) VALUES ('seo', 'from the worktree', :me)"], { user: null });
  assert.equal(r.code, 0, r.err);
  assert.equal((await p.one('SELECT created_by FROM tasks')).created_by, 'sam');
  assert.ok(fs.lstatSync(path.join(wt, 'desks/data')).isSymbolicLink(), 'the worktree has a data folder of its own');
  fs.writeFileSync(path.join(wt, 'desks/data/body.txt'), 'kept');
  assert.equal(fs.readFileSync(path.join(p.dir, 'desks/data/body.txt'), 'utf8'), 'kept');
  assert.equal(execFileSync('git', ['status', '--porcelain'], { cwd: wt, encoding: 'utf8' }), '');

  fs.writeFileSync(path.join(wt, 'desks/.env'), 'DESK_USER=kim\n');
  const own = await run(wt, ['sql', '--json', 'SELECT :me AS me'], { user: null });
  assert.equal(JSON.parse(own.out)[0].me, 'kim');
  const doctor = await run(wt, ['doctor'], { user: null });
  assert.equal(doctor.code, 0, doctor.out);
  assert.match(doctor.out, /settings and the local database come from the main checkout/);

  fs.unlinkSync(path.join(wt, 'desks/data'));
  fs.mkdirSync(path.join(wt, 'desks/data'));
  assert.match((await run(wt, ['doctor'], { user: null })).out, /desks\/data here is the worktree's own folder/);
});

test('export writes CSV that survives commas, quotes and new lines', async () => {
  const p = await project();
  await p.sql(`INSERT INTO people(id, name, notes) VALUES ('jo', 'Bloggs, Jo', 'said "hi"\nthen left')`);
  const r = await p.run(['export', 'people', 'out/people.csv']);
  assert.equal(r.code, 0, r.err);
  const csv = fs.readFileSync(path.join(p.dir, 'out/people.csv'), 'utf8');
  assert.match(csv, /^id,name,org,role,known_to,notes,source,created_at,updated_at\n/);
  assert.match(csv, /jo,"Bloggs, Jo",,,,"said ""hi""\nthen left",/);
});

test('a dump restores into an empty database with every guard back in place', async () => {
  const p = await project({ seo: { schema: 'CREATE TABLE IF NOT EXISTS seo_pages (key TEXT PRIMARY KEY, title TEXT, clicks REAL, raw BLOB);' } });
  const id = await create(p, { body: "It's \"quoted\"\nand multi-line" });
  await p.sql(`${humanSend(id)}
    INSERT INTO seo_pages VALUES ('page:/a', 'A', 12.5, X'00ff'), ('page:/b', NULL, NULL, NULL);
    INSERT INTO holds(about, reason, by) VALUES ('domain:acme.com', 'paused', 'doug');`);
  await p.run(['lock', 'page:/a', 'rewriting']);
  const dumped = await p.run(['dump', 'desks/data/backup.sql']);
  assert.equal(dumped.code, 0, dumped.err);

  const local = { DESK_DB: 'file:desks/data/restored.db' };
  const r = await p.run(['restore', 'desks/data/backup.sql'], { env: local });
  assert.equal(r.code, 0, r.err + r.out);
  const read = async (sql) => JSON.parse((await p.run(['sql', '--json', sql], { env: local })).out);
  const same = async (sql) => assert.deepEqual(await read(sql), await p.sql(sql), sql);
  await same('SELECT * FROM actions');
  await same('SELECT * FROM log ORDER BY id');
  await same("SELECT key, title, clicks, hex(raw) AS raw FROM seo_pages ORDER BY key");
  await same('SELECT key, by, doing FROM locks');
  await same('SELECT * FROM trust');
  const bad = await p.run(['sql', 'DELETE FROM log'], { env: local });
  assert.match(bad.err, /never deleted/);
  const again = await p.run(['restore', 'desks/data/backup.sql'], { env: local });
  assert.match(again.err, /already has tables/);
});

// ---------- working together ----------

test('people racing for one lock: exactly one gets it', async () => {
  const p = await project();
  const people = ['ana', 'ben', 'cat', 'dan', 'eve', 'fay', 'gus', 'hal'];
  const results = await Promise.all(people.map((u) => p.run(['lock', 'page:/stores/nike', `rewriting the title (${u})`], { user: u })));
  const winners = people.filter((u, i) => results[i].code === 0);
  assert.equal(winners.length, 1, results.map((r) => r.out + r.err).join('\n'));
  for (const r of results.filter((x) => x.code !== 0)) assert.match(r.out, new RegExp(`held by ${winners[0]}`));
  const lock = await p.one("SELECT by, desk FROM locks WHERE key = 'page:/stores/nike'");
  assert.deepEqual(lock, { by: winners[0], desk: 'seo' });
});

test('taking a lock over is logged with what they were doing', async () => {
  const p = await project();
  await p.run(['lock', 'brand:acme', 'checking their reply'], { user: 'sam' });
  const r = await p.run(['take', 'brand:acme', 'sending the follow-up']);
  assert.match(r.out, /Took brand:acme from sam/);
  const log = await p.one("SELECT by, summary, details FROM log WHERE kind = 'takeover'");
  assert.equal(log.by, 'doug');
  assert.deepEqual(JSON.parse(log.details).was_doing, 'checking their reply');
});

test('unlock only releases your own lock', async () => {
  const p = await project();
  await p.run(['lock', 'brand:acme', 'checking'], { user: 'sam' });
  const r = await p.run(['unlock', 'brand:acme']);
  assert.equal(r.code, 2);
  assert.equal((await p.one("SELECT by FROM locks WHERE key = 'brand:acme'")).by, 'sam');
  assert.equal((await p.run(['unlock', 'brand:acme'], { user: 'sam' })).code, 0);
  assert.equal((await p.sql('SELECT * FROM locks')).length, 0);
});

test('workers racing to send the same action: exactly one sends it', async () => {
  const p = await project();
  const id = await create(p);
  await p.sql(approve(id));
  const workers = ['w1', 'w2', 'w3', 'w4', 'w5', 'w6', 'w7', 'w8'];
  const results = await Promise.all(workers.map((u) => p.run(['sql', '--json',
    `UPDATE actions SET status = 'sending', mode = 'human', sent_by = :me, last_by = :me WHERE id = ${id} AND status = 'approved' RETURNING id`], { user: u })));
  const claimed = results.filter((r) => r.code === 0 && JSON.parse(r.out).length === 1);
  assert.equal(claimed.length, 1, results.map((r) => r.out + r.err).join('\n'));
  assert.equal((await p.one(`SELECT count(*) AS n FROM log WHERE action_id = ${id} AND summary LIKE '%> sending%'`)).n, 1);
  await p.fails(claim(id, 'human', 'w9'), /already being sent/);
});

test('two desks share one database, and a lock taken for one blocks a send from the other', async () => {
  const p = await project({ seo: {}, outreach: { headline: 'replies-week' } });
  await p.run(['lock', 'brand:acme', 'updating their store page', '--desk', 'seo'], { user: 'sam' });
  const id = await create(p, { desk: 'outreach', kind: 'first-touch' });
  await p.sql(approve(id));
  await p.fails(claim(id), /locked: someone else is working on this/);
  const status = JSON.parse((await p.run(['status', '--json'])).out);
  assert.deepEqual(status.board.map((b) => [b.desk, b.waiting, b.locks]), [['outreach', 0, 0], ['seo', 0, 1]]);
  assert.equal(status.in_flight.length, 1);
});

// ---------- actions ----------

test('only the allowed status moves are possible, and attempted content never changes', async () => {
  const p = await project();
  const id = await create(p);
  await p.fails(`UPDATE actions SET status = 'verified' WHERE id = ${id}`, /status change is not allowed/);
  await p.fails(`UPDATE actions SET status = 'sending', mode = 'human', sent_by = 'doug' WHERE id = ${id}`, /status change is not allowed|only an approved action/);
  await p.fails(`UPDATE actions SET status = 'approved', approved_version = 1 WHERE id = ${id}`, /say who approved it/);
  await p.sql(`${approve(id)}\n${claim(id)}`);
  await p.fails(`UPDATE actions SET status = 'approved' WHERE id = ${id}`, /not allowed/);
  await p.fails(`UPDATE actions SET body = 'changed' WHERE id = ${id}`, /already attempted/);
  await p.sql(`UPDATE actions SET status = 'uncertain', result = 'timed out' WHERE id = ${id}`);
  const board = JSON.parse((await p.run(['status', '--json'])).out).board[0];
  assert.equal(board.uncertain, 1);
  await p.sql(`UPDATE actions SET status = 'sent', result = 'found in Sent' WHERE id = ${id}`);
  await p.fails(`UPDATE actions SET kind = 'other' WHERE id = ${id}`, /fixed/);
  await p.fails(newAction({ status: 'approved' }), /starts as draft or waiting/);
});

test('approval covers only the version the person saw', async () => {
  const p = await project();
  const id = await create(p);
  await p.sql(`UPDATE actions SET body = 'Hi Jo, shorter' WHERE id = ${id}`);
  const a = await p.one(`SELECT version, edited, first_body FROM actions WHERE id = ${id}`);
  assert.deepEqual(a, { version: 2, edited: 1, first_body: 'Hi Jo' });
  await p.fails(approve(id, 1), /changed since it was shown/);
  await p.sql(approve(id, 2));
  await p.sql(`UPDATE actions SET title = 'Hello again' WHERE id = ${id}`);
  const b = await p.one(`SELECT status, version, approved_by FROM actions WHERE id = ${id}`);
  assert.deepEqual(b, { status: 'waiting', version: 3, approved_by: null });
});

test('the log is append only', async () => {
  const p = await project();
  await create(p);
  await p.fails('UPDATE log SET summary = 1', /never changed/);
  await p.fails('DELETE FROM log', /never deleted/);
  const log = await p.sql('SELECT kind, summary FROM log');
  assert.equal(log.length, 1);
  assert.match(log[0].summary, /email-reply prepared \(waiting\): Hello/);
});

test('sending a message logs an out, so follow-ups know who spoke last', async () => {
  const p = await project();
  const id = await create(p);
  await p.sql(humanSend(id));
  assert.deepEqual((await p.sql('SELECT about, sent FROM waiting_on_them')), [{ about: 'brand:acme', sent: 1 }]);
  await p.sql(`INSERT INTO log(desk, by, kind, about, summary) VALUES ('seo', 'agent', 'in', 'brand:acme', 'Jo replied')`);
  assert.deepEqual(await p.sql('SELECT * FROM waiting_on_them'), []);
});

// ---------- trust ----------

test('the trust ladder: two coached, five clean, then on its own with a spot check every fifth', async () => {
  const p = await project();

  for (let i = 0; i < 2; i++) {
    const id = await create(p);
    assert.equal((await p.one(`SELECT stage FROM actions WHERE id = ${id}`)).stage, 'coached');
    await p.sql(humanSend(id));
  }
  assert.equal((await trustRow(p)).coached, 2);

  const early = await create(p, { status: 'draft' });
  assert.equal((await p.one(`SELECT stage FROM actions WHERE id = ${early}`)).stage, 'drafted');
  await p.fails(claim(early, 'auto'), /not trusted to go out on its own yet/);
  await p.sql(`UPDATE actions SET status = 'waiting' WHERE id = ${early}; ${humanSend(early)}`);
  for (let i = 0; i < 4; i++) await p.sql(humanSend(await create(p)));
  let t = await trustRow(p);
  assert.deepEqual([t.clean, t.trusted], [5, 1]);

  const unallowed = await create(p, { status: 'draft' });
  await p.fails(claim(unallowed, 'auto'), /nobody has allowed this/);
  await p.sql(`INSERT INTO allowed(desk, kind, channel, identity, words, by)
    VALUES ('seo', 'email-reply', 'email', 'doug@x.com', 'send routine replies yourself', 'doug')`);

  await p.sql(`${claim(unallowed, 'auto')}\n${land(unallowed)}`);
  for (let i = 0; i < 3; i++) {
    const id = await create(p, { status: 'draft' });
    await p.sql(`${claim(id, 'auto')}\n${land(id)}`);
  }
  t = await trustRow(p);
  assert.deepEqual([t.since_check, t.clean], [4, 5], 'automatic sends do not add to the clean count');

  const fifth = await create(p, { status: 'draft' });
  await p.fails(claim(fifth, 'auto'), /spot check due/);
  await p.sql(`UPDATE actions SET status = 'waiting' WHERE id = ${fifth}; ${humanSend(fifth)}`);
  t = await trustRow(p);
  assert.deepEqual([t.since_check, t.clean, t.trusted], [0, 6, 1]);
  const after = await create(p, { status: 'draft' });
  await p.sql(claim(after, 'auto'));

  const bad = await create(p);
  await p.sql(`UPDATE actions SET status = 'rejected', result = 'wrong tone', last_by = 'doug' WHERE id = ${bad}`);
  t = await trustRow(p);
  assert.deepEqual([t.clean, t.trusted, t.epoch], [0, 0, 1]);
  await p.fails(claim(await create(p, { status: 'draft' }), 'auto'), /not trusted/);
  assert.match((await p.one("SELECT stage FROM trust_board WHERE kind = 'email-reply'")).stage, /drafts for review \(0\/5 clean\)/);
});

test('a change after review starts trust again, and an approval from before does not count', async () => {
  const p = await project();
  await p.sql("INSERT INTO trust(desk, kind, channel, identity, coach_needed) VALUES ('seo', 'email-reply', 'email', 'doug@x.com', 0)");
  const older = await create(p);
  await p.sql(approve(older));
  for (let i = 0; i < 2; i++) await p.sql(humanSend(await create(p)));
  assert.equal((await trustRow(p)).clean, 2);

  const edited = await create(p);
  await p.sql(`UPDATE actions SET body = 'Hi Jo, warmer', last_by = 'doug' WHERE id = ${edited}`);
  let t = await trustRow(p);
  assert.deepEqual([t.clean, t.epoch], [0, 1]);
  await p.sql(humanSend(edited, 2));
  assert.equal((await trustRow(p)).clean, 0, 'an edited action does not count as clean');

  await p.sql(`${claim(older)}\n${land(older)}`);
  assert.equal((await trustRow(p)).clean, 0, 'approved before the reset, so it does not count');
  await p.sql(humanSend(await create(p)));
  assert.equal((await trustRow(p)).clean, 1);
  assert.equal((await p.one("SELECT count(*) AS n FROM log WHERE kind = 'trust'")).n, 1);
});

test('always-human kinds never go out on their own', async () => {
  const p = await project();
  await p.sql(`INSERT INTO trust(desk, kind, channel, identity, coach_needed, trusted, always_human)
      VALUES ('seo', 'contract', 'email', 'doug@x.com', 0, 1, 1);
    INSERT INTO allowed(desk, kind, channel, identity, words, by) VALUES ('seo', 'contract', 'email', 'doug@x.com', 'go ahead', 'doug');`);
  await p.fails(claim(await create(p, { kind: 'contract', status: 'draft' }), 'auto'), /not trusted/);
  for (let i = 0; i < 6; i++) await p.sql(humanSend(await create(p, { kind: 'contract' })));
  assert.equal((await trustRow(p, 'contract')).always_human, 1);
  assert.equal((await p.one("SELECT stage FROM trust_board WHERE kind = 'contract'")).stage, 'always a person');
});

// ---------- holds ----------

test('trusted sends still stop for holds and for other people\'s locks', async () => {
  const p = await project();
  await p.sql(`INSERT INTO trust(desk, kind, channel, identity, coach_needed, trusted, clean)
      VALUES ('seo', 'digest', 'email', 'doug@x.com', 0, 1, 5);
    INSERT INTO allowed(desk, kind, channel, identity, words, by) VALUES ('seo', 'digest', 'email', 'doug@x.com', 'send the digest', 'doug');`);
  const id = await create(p, { kind: 'digest', status: 'draft' });
  await p.sql("INSERT INTO holds(about, reason, by) VALUES ('domain:acme.com', 'legal asked us to pause', 'doug')");
  await p.fails(claim(id, 'auto'), /held/);
  await p.sql("UPDATE holds SET released_at = :now, released_by = :me, release_reason = 'cleared'");
  await p.run(['lock', 'brand:acme', 'on a call with them'], { user: 'sam' });
  await p.fails(claim(id, 'auto'), /locked/);
  await p.run(['take', 'brand:acme', 'sending the digest']);
  await p.sql(claim(id, 'auto'));
});

test('holds match any case, cc and bcc, the person behind an address, and their scope', async () => {
  const p = await project({ seo: {}, outreach: {} });
  await p.sql(`INSERT INTO people(id, name) VALUES ('jo-bloggs', 'Jo Bloggs');
    INSERT INTO contacts(person, channel, address, source) VALUES ('jo-bloggs', 'email', 'jo@acme.com', 'their signature');`);
  const blocked = async (hold, action, expect) => {
    await p.sql(`UPDATE holds SET released_at = :now, released_by = :me WHERE released_at IS NULL; ${hold}`);
    const id = await create(p, action);
    await p.sql(approve(id));
    if (expect) await p.fails(claim(id), /held/);
    else await p.sql(claim(id));
  };
  const hold = (about, extra = '') => `INSERT INTO holds(about, reason, by${extra ? ', desk, topic, until' : ''})
    VALUES (${q(about)}, 'test', 'doug'${extra})`;
  await blocked(hold('person:jo-bloggs'), { target: 'email:JO@ACME.COM' }, true);
  await blocked(hold('email:cc@other.com'), { target: 'email:x@y.com', about: 'brand:y', payload: '{"cc":["CC@Other.com"]}' }, true);
  await blocked(hold('email:bcc@other.com'), { target: 'email:x@y.com', about: 'brand:y', payload: '{"bcc":["bcc@other.com"]}' }, true);
  await blocked(hold('brand:covered'), { target: 'email:x@agency.com', about: 'brand:agency', payload: '{"covers":["brand:one","brand:covered"]}' }, true);
  await blocked(hold('brand:acme', ", 'outreach', 'all', NULL"), {}, false);
  await blocked(hold('brand:acme', ", 'seo', 'first-touch', NULL"), {}, false);
  await blocked(hold('brand:acme', ", 'seo', 'all', date('now', '-1 day')"), {}, false);
  await blocked(hold('brand:acme', ", 'seo', 'all', date('now', '+1 day')"), {}, true);
  await blocked(hold('*', ", 'seo', 'all', NULL"), { target: 'email:anyone@else.com', about: 'brand:else' }, true);
});

// ---------- changes and measures ----------

test('due shows open tasks and changes ready to measure', async () => {
  const p = await project();
  await p.sql(`INSERT INTO tasks(desk, what, due, created_by) VALUES
      ('seo', 'overdue', date('now', '-1 day'), 'doug'), ('seo', 'later', date('now', '+3 day'), 'doug'), ('seo', 'now', NULL, 'doug');
    INSERT INTO tasks(desk, what, status, created_by) VALUES ('seo', 'finished', 'done', 'doug');
    INSERT INTO checks(desk, about, metric, baseline, check_at, created_by) VALUES
      ('seo', 'page:/a', 'clicks', 40, date('now'), 'doug'), ('seo', 'page:/b', 'clicks', 40, date('now', '+14 day'), 'doug');
    INSERT INTO checks(desk, about, metric, baseline, check_at, value, verdict, created_by, measured_at, measured_by) VALUES
      ('seo', 'page:/c', 'clicks', 40, date('now', '-1 day'), 55, 'better', 'doug', :now, 'doug');`);
  const due = await p.sql('SELECT type, about, what FROM due ORDER BY type, what');
  assert.deepEqual(due.map((d) => `${d.type}:${d.what}`), ['check:measure clicks', 'task:now', 'task:overdue']);
});

test('status keeps long lists short: the newest holds and the first due, with how to see the rest', async () => {
  const p = await project();
  const holds = Array.from({ length: 14 }, (_, i) => `('seo', 'brand:b${i}', 'reason ${i}', 'doug')`).join(', ');
  const tasks = Array.from({ length: 23 }, (_, i) => `('seo', 'task ${i}', 'doug')`).join(', ');
  await p.sql(`INSERT INTO holds(desk, about, reason, by) VALUES ${holds};
    INSERT INTO tasks(desk, what, created_by) VALUES ${tasks};`);
  const r = await p.run(['status']);
  assert.match(r.out, /Holds \(14, newest first\)/);
  assert.match(r.out, /brand:b13/);
  assert.doesNotMatch(r.out, /brand:b3 /);
  assert.match(r.out, /\.\.\. and 4 more: node desks\/desk\.mjs sql "SELECT \* FROM active_holds"/);
  assert.match(r.out, /\.\.\. and 3 more: node desks\/desk\.mjs sql "SELECT \* FROM due"/);
  const json = JSON.parse((await p.run(['status', '--json'])).out);
  assert.equal(json.holds.length, 14);
  assert.equal(json.due.length, 23);
});

test('the board shows the headline with its previous value', async () => {
  const p = await project();
  await p.sql(`INSERT INTO measures(desk, name, value, source, by, observed_at) VALUES
    ('seo', 'clicks-7d', 900, 'search console', 'doug', '2026-10-01T00:00:00Z'),
    ('seo', 'clicks-7d', 1100, 'search console', 'doug', '2026-10-08T00:00:00Z')`);
  const r = await p.run(['status']);
  assert.match(r.out, /seo: 0 waiting · 0 due · 0 in flight · clicks-7d 1100 \(was 900\) · target 100 a week/);
});
