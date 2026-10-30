#!/usr/bin/env node
// The desk's one script. Every read and write goes through it, against this machine's
// SQLite file or a hosted libsql server, with the same SQL. No dependencies: Node 22+.
//
//   node desks/desk.mjs init                      create or upgrade the database (safe to repeat)
//   node desks/desk.mjs status [desk]             what needs attention
//   node desks/desk.mjs sql "SELECT ..."          run SQL; several statements run all-or-nothing
//   node desks/desk.mjs sql - <<'SQL' ... SQL     SQL from stdin, with no quoting to fight
//   node desks/desk.mjs lock <key> "<doing>"      start working on something
//   node desks/desk.mjs unlock <key>              finished with it
//   node desks/desk.mjs take <key> "<doing>"      take it over from whoever has it
//   node desks/desk.mjs export <table|view> [file.csv]
//   node desks/desk.mjs dump [file.sql]           everything, as SQL: a backup, or to move databases
//   node desks/desk.mjs restore <file.sql>        load a dump into an empty database
//   node desks/desk.mjs doctor                    check settings, connection, schema and each desk's needs
//   node desks/desk.mjs token                     make a key and token for a hosted database
//   node desks/desk.mjs watch <desk>              wait for mail to the desk's Mail: addresses, print a line
//                                                 for each and exit (--every 30s, --max 25m)
//   node desks/desk.mjs mail inbox|search <text>|sent   mail in the mail Worker (--desk, --mailbox, --limit,
//                                                 --key for sent)
//   node desks/desk.mjs mail read|thread <id>     one email in full, or its whole conversation
//   node desks/desk.mjs mail status|suppressions  the Worker's addresses, sends and caps; who never gets mail
//   node desks/desk.mjs mail suppress <address> "<reason>"
//   node desks/desk.mjs send <action id>          send an approved email action exactly as stored, and record it
//
// In SQL, :me is you (DESK_USER), :now the time, :today the date and :desk the --desk value.
// Add your own with -a name=value, or -a name=@path to read a file, so long text needs no
// escaping. --json prints rows as JSON; --full prints whole values, one row at a time.
// --expect-rows exits 1 when the last statement returns or changes no rows, so a claim
// chained to a send with && stops the send when the claim gets nothing.
//
// Settings come from the environment, then desks/.env, then the project's .env (DESK_* only).
// In a git worktree, the main checkout's files fill in what the worktree's don't set, and a
// local database lives in the main checkout, so every worktree works on the same one:
//   DESK_DB        file:desks/data/desk.db (the default), or https://<host> for a hosted database
//   DESK_DB_TOKEN  the token for a hosted database: its secret, or a JWT from the token command
//   DESK_USER      who you are: doug, sam
//   DESK_MAIL_URL  the mail Worker that desks with a Mail: line listen to (kit/mail/README.md)
//   DESK_MAIL_TOKEN  that Worker's MAIL_API_TOKEN
//   DESK_MAIL_PREFIX  the word inbox ids for mail start with: mail (the default), or the one
//                     a project's own Worker already uses (acme-mail:<mailbox>:<id>)

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const DESKS = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.dirname(DESKS);
const MAIN = mainCheckout(ROOT);
const KIT = path.join(DESKS, 'kit');

// ---------- settings ----------

// The main checkout when root is a linked git worktree, else root itself.
function mainCheckout(root) {
  try {
    const dotgit = path.join(root, '.git');
    if (!fs.statSync(dotgit).isFile()) return root;
    const gitdir = path.resolve(root, fs.readFileSync(dotgit, 'utf8').match(/^gitdir:\s*(.+)$/m)[1].trim());
    const common = path.resolve(gitdir, fs.readFileSync(path.join(gitdir, 'commondir'), 'utf8').trim());
    return path.basename(common) === '.git' ? path.dirname(common) : root;
  } catch {
    return root;
  }
}

function readEnvFile(file) {
  const out = {};
  if (!fs.existsSync(file)) return out;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    let v = m[2];
    if (/^(['"]).*\1$/.test(v)) v = v.slice(1, -1);
    else v = v.replace(/\s+#.*$/, '');
    out[m[1]] = v;
  }
  return out;
}

const projectEnv = { ...readEnvFile(path.join(MAIN, '.env')), ...readEnvFile(path.join(ROOT, '.env')) };
const deskEnv = { ...readEnvFile(path.join(MAIN, 'desks', '.env')), ...readEnvFile(path.join(DESKS, '.env')) };
function setting(name, fallback) {
  return process.env[name] ?? deskEnv[name] ?? (name.startsWith('DESK_') ? projectEnv[name] : undefined) ?? fallback;
}
function hasSetting(name) {
  return Boolean(process.env[name] ?? deskEnv[name] ?? projectEnv[name]);
}

const DB = setting('DESK_DB', 'file:desks/data/desk.db');
const TOKEN = setting('DESK_DB_TOKEN');
const USER = setting('DESK_USER');
const HOSTED = /^(https?|libsql):\/\//.test(DB);
const MAIL_URL = setting('DESK_MAIL_URL')?.replace(/\/+$/, '');
const MAIL_TOKEN = setting('DESK_MAIL_TOKEN');
const MAIL_PREFIX = setting('DESK_MAIL_PREFIX', 'mail');

class DeskError extends Error {}
const fail = (msg) => { throw new DeskError(msg); };

// ---------- SQL: split into statements and find the parameters each one uses ----------

export function splitSql(text) {
  const out = [];
  let start = 0, i = 0, params = new Set(), words = [];
  let trigger = false, body = false, caseDepth = 0;
  const n = text.length;
  const finish = (end) => {
    const sql = text.slice(start, end).trim();
    if (words.length) out.push({ sql, params: [...params], first: words[0] });
    start = end + 1; params = new Set(); words = []; trigger = body = false; caseDepth = 0;
  };
  while (i < n) {
    const c = text[i];
    if (c === "'" || c === '"' || c === '`') {
      i++;
      while (i < n && !(text[i] === c && text[i + 1] !== c)) i += text[i] === c ? 2 : 1;
      i++;
    } else if (c === '[') {
      const j = text.indexOf(']', i); i = j < 0 ? n : j + 1;
    } else if (c === '-' && text[i + 1] === '-') {
      const j = text.indexOf('\n', i); i = j < 0 ? n : j + 1;
    } else if (c === '/' && text[i + 1] === '*') {
      const j = text.indexOf('*/', i + 2); i = j < 0 ? n : j + 2;
    } else if ((c === ':' || c === '@' || c === '$') && /[A-Za-z_]/.test(text[i + 1] || '')) {
      let j = i + 1;
      while (j < n && /[A-Za-z0-9_]/.test(text[j])) j++;
      params.add(text.slice(i, j)); i = j;
    } else if (/[A-Za-z_]/.test(c)) {
      let j = i;
      while (j < n && /[A-Za-z0-9_$]/.test(text[j])) j++;
      const w = text.slice(i, j).toUpperCase();
      words.push(w);
      if (words.length <= 3 && w === 'TRIGGER' && words[0] === 'CREATE') trigger = true;
      else if (trigger && !body && w === 'BEGIN') body = true;
      else if (body && w === 'CASE') caseDepth++;
      else if (body && w === 'END') { if (caseDepth) caseDepth--; else body = false; }
      i = j;
    } else if (c === ';' && !body) {
      finish(i); i++;
    } else {
      if (!/\s/.test(c) && !words.length) words.push(c);
      i++;
    }
  }
  finish(n);
  return out;
}

const READS = new Set(['SELECT', 'EXPLAIN', 'VALUES']);
const TX = new Set(['BEGIN', 'COMMIT', 'END', 'ROLLBACK', 'SAVEPOINT', 'RELEASE']);
const WRITES = new Set(['INSERT', 'UPDATE', 'DELETE', 'REPLACE']);

function autoParams(extra = {}) {
  const now = new Date().toISOString();
  return { me: USER, now, today: now.slice(0, 10), ...extra };
}

function bindStatements(text, values) {
  const stmts = splitSql(text);
  return stmts.map((s) => {
    const args = {};
    for (const p of s.params) {
      const name = p.slice(1);
      if (!(name in values) || values[name] === undefined) {
        if (name === 'me') fail('the SQL uses :me but DESK_USER is not set. Put DESK_USER=<your name> in desks/.env');
        if (name === 'desk') fail('the SQL uses :desk: pass --desk <name> (it is filled in for you only when there is one desk)');
        fail(`the SQL uses ${p} but nothing was given for it: add -a ${name}=...`);
      }
      args[p] = values[name];
    }
    return { sql: s.sql, args, first: s.first };
  });
}

// ---------- connections ----------

async function open() {
  return HOSTED ? openHosted(DB, TOKEN) : openLocal(DB);
}

function localPath(db) {
  const p = db.replace(/^file:/, '');
  return path.isAbsolute(p) ? p : path.join(MAIN, p);
}

async function openLocal(db) {
  const [major, minor] = process.versions.node.split('.').map(Number);
  if (major < 22 || (major === 22 && minor < 16)) fail(`a local database needs Node 22.16 or newer (this is ${process.versions.node})`);
  const file = localPath(db);
  const dir = path.dirname(file);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const fresh = !fs.existsSync(file);
  const emit = process.emitWarning;
  process.emitWarning = (w, ...rest) => (String(w).includes('SQLite') ? undefined : emit.call(process, w, ...rest));
  const { DatabaseSync } = await import('node:sqlite');
  const conn = new DatabaseSync(file);
  if (fresh) fs.chmodSync(file, 0o600);
  conn.exec('PRAGMA busy_timeout = 15000; PRAGMA foreign_keys = ON;');
  try { conn.exec('PRAGMA journal_mode = WAL;'); } catch {}
  return {
    where: path.relative(process.cwd(), file).startsWith('..') ? file : path.relative(process.cwd(), file) || file,
    async run(stmts, { tx }) {
      const results = [];
      if (tx) conn.exec('BEGIN IMMEDIATE');
      try {
        stmts.forEach((s, index) => {
          try {
            const st = conn.prepare(s.sql);
            const cols = st.columns().map((c) => c.name);
            if (cols.length) {
              st.setReturnArrays(true);
              const rows = st.all(s.args).map((r) => r.map((v) => (v instanceof Uint8Array ? Buffer.from(v) : v)));
              results.push({ cols, rows, changes: rows.length });
            } else {
              const r = st.run(s.args);
              results.push({ cols, rows: [], changes: Number(r.changes) });
            }
          } catch (e) {
            e.index = index;
            throw e;
          }
        });
        if (tx) conn.exec('COMMIT');
      } catch (e) {
        if (tx) try { conn.exec('ROLLBACK'); } catch {}
        throw e;
      }
      return results;
    },
    close() { conn.close(); },
  };
}

function toValue(v) {
  if (v === null || v === undefined) return { type: 'null' };
  if (typeof v === 'number') return Number.isInteger(v) ? { type: 'integer', value: String(v) } : { type: 'float', value: v };
  if (typeof v === 'bigint') return { type: 'integer', value: v.toString() };
  if (Buffer.isBuffer(v)) return { type: 'blob', base64: v.toString('base64') };
  return { type: 'text', value: String(v) };
}
function fromValue(v) {
  switch (v.type) {
    case 'null': return null;
    case 'integer': { const n = Number(v.value); return Number.isSafeInteger(n) ? n : v.value; }
    case 'float': return v.value;
    case 'blob': return Buffer.from(v.base64, 'base64');
    default: return v.value;
  }
}

async function openHosted(url, token) {
  const base = url.replace(/^libsql:\/\//, 'https://').replace(/\/+$/, '');
  return {
    where: base,
    async run(stmts, { tx }) {
      const all = [{ sql: 'PRAGMA foreign_keys = ON', args: {} }];
      if (tx) all.push({ sql: 'BEGIN IMMEDIATE', args: {} });
      const offset = all.length;
      all.push(...stmts);
      if (tx) all.push({ sql: 'COMMIT', args: {} });
      const steps = all.map((s, i) => ({
        stmt: {
          sql: s.sql,
          named_args: Object.entries(s.args).map(([name, value]) => ({ name, value: toValue(value) })),
          want_rows: true,
        },
        ...(i ? { condition: { type: 'ok', step: i - 1 } } : {}),
      }));
      if (tx) steps.push({ stmt: { sql: 'ROLLBACK' }, condition: { type: 'not', cond: { type: 'ok', step: all.length - 1 } } });
      let res;
      try {
        res = await fetch(`${base}/v2/pipeline`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', ...(token ? { authorization: authHeader(token) } : {}) },
          body: JSON.stringify({ baton: null, requests: [{ type: 'batch', batch: { steps } }, { type: 'close' }] }),
          signal: AbortSignal.timeout(30000),
        });
      } catch (e) {
        const code = e.cause?.code || e.message;
        const err = new DeskError(`could not reach the hosted database at ${base} (${code})`);
        err.unreached = !['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN'].includes(code);
        throw err;
      }
      if (res.status === 401 || res.status === 403) fail(`the hosted database refused the token (${res.status}): check DESK_DB_TOKEN in desks/.env`);
      if (res.status >= 500) throw retryable(`the hosted database answered ${res.status}: ${(await res.text()).slice(0, 300)}`);
      if (!res.ok) fail(`the hosted database answered ${res.status}: ${(await res.text()).slice(0, 300)}`);
      const [first] = (await res.json()).results;
      if (first.type === 'error') fail(first.error.message);
      const { step_results: results, step_errors: errors } = first.response.result;
      const bad = errors.findIndex((e) => e);
      if (bad >= 0) {
        const err = new Error(errors[bad].message);
        err.index = bad - offset;
        throw err;
      }
      return results.slice(offset, offset + stmts.length).map((r) => ({
        cols: r.cols.map((c) => c.name),
        rows: r.rows.map((row) => row.map(fromValue)),
        changes: r.cols.length ? r.rows.length : r.affected_row_count,
      }));
    },
    close() {},
  };
}

// Run SQL on a connection of its own, and close it: each statement's results.
async function query(text, values = {}) {
  const db = await open();
  try { return (await execute(db, text, autoParams(values))).results; } finally { db.close(); }
}

// Run SQL text. Writes run all-or-nothing unless the SQL manages its own transaction.
// A busy database is retried; nothing is retried after a lost connection, because the
// change may have been saved.
async function execute(db, text, values = autoParams()) {
  const stmts = bindStatements(text, values);
  if (!stmts.length) return { stmts, results: [], tx: false };
  const own = stmts.some((s) => TX.has(s.first));
  const setsPragma = stmts.some((s) => s.first === 'PRAGMA' && s.sql.includes('='));
  const readOnly = stmts.every((s) => READS.has(s.first) || (s.first === 'PRAGMA' && !s.sql.includes('=')));
  const tx = stmts.length > 1 && !own && !setsPragma && !readOnly;
  const whole = tx || (stmts.length === 1 && !own);
  for (let attempt = 0; ; attempt++) {
    try {
      return { stmts, results: await db.run(stmts, { tx }), tx };
    } catch (e) {
      const busy = /database is locked|SQLITE_BUSY|database table is locked/i.test(e.message);
      if (busy && (whole || readOnly) && attempt < 6) {
        await new Promise((r) => setTimeout(r, 50 * 2 ** attempt + Math.random() * 100));
        continue;
      }
      if (e.unreached && !readOnly) {
        e.message += '. If this was a write it may or may not have been saved: read it back before doing it again.';
      }
      if (e.index !== undefined && e.index >= 0 && stmts[e.index]) {
        const s = stmts[e.index].sql.replace(/\s+/g, ' ');
        const where = stmts.length > 1 ? ` (statement ${e.index + 1}: ${s.length > 70 ? `${s.slice(0, 67)}...` : s})` : '';
        const saved = whole && !readOnly ? ' Nothing was saved.' : '';
        throw new DeskError(`${cleanError(e.message)}${where}.${saved}`);
      }
      throw e instanceof DeskError ? e : new DeskError(cleanError(e.message));
    }
  }
}

function cleanError(msg) {
  return String(msg)
    .replace(/^SQLite error:\s*/i, '')
    .replace(/^SQLITE_[A-Z_]+:\s*/i, '')
    .replace(/^Error:\s*/i, '')
    .replace(/\s+\(\d+\)$/, '');
}

// ---------- output ----------

function cell(v) {
  if (v === null || v === undefined) return '';
  if (Buffer.isBuffer(v)) return `<${v.length} bytes>`;
  return String(v);
}

function table(cols, rows) {
  if (!rows.length) return '(no rows)';
  const clip = (s) => {
    s = s.replace(/\r?\n/g, ' ⏎ ');
    return s.length > 60 ? `${s.slice(0, 57)}...` : s;
  };
  const data = rows.map((r) => r.map((v) => clip(cell(v))));
  const width = cols.map((c, i) => Math.max(c.length, ...data.map((r) => r[i].length)));
  const line = (r) => r.map((v, i) => v.padEnd(width[i])).join('  ').trimEnd();
  return [line(cols), line(width.map((w) => '-'.repeat(w))), ...data.map(line)].join('\n');
}

function records(cols, rows) {
  if (!rows.length) return '(no rows)';
  const w = Math.max(...cols.map((c) => c.length));
  return rows.map((r) => cols.map((c, i) => {
    const v = cell(r[i]);
    return `${c.padEnd(w)}  ${v.includes('\n') ? `\n${v.replace(/^/gm, '    ')}` : v}`;
  }).join('\n')).join('\n\n');
}

const asObjects = (cols, rows) => rows.map((r) => Object.fromEntries(cols.map((c, i) => [c, Buffer.isBuffer(r[i]) ? r[i].toString('base64') : r[i]])));

function print({ stmts, results }, flags) {
  if (flags.json) {
    const shown = results.map((r, i) => ({ r, s: stmts[i] })).filter(({ r }) => r.cols.length);
    if (shown.length === 1 && results.length === 1) console.log(JSON.stringify(asObjects(shown[0].r.cols, shown[0].r.rows), null, 2));
    else console.log(JSON.stringify(results.map((r, i) => (r.cols.length
      ? { statement: i + 1, rows: asObjects(r.cols, r.rows) }
      : { statement: i + 1, changes: r.changes })), null, 2));
    return;
  }
  const parts = [];
  results.forEach((r, i) => {
    if (r.cols.length) parts.push({ rows: true, text: flags.full ? records(r.cols, r.rows) : table(r.cols, r.rows) });
    else if (WRITES.has(stmts[i].first)) parts.push({ rows: false, text: `${r.changes} row${r.changes === 1 ? '' : 's'} changed` });
  });
  if (parts.length) console.log(parts.map((p, i) => (i && (p.rows || parts[i - 1].rows) ? '\n' : '') + p.text).join('\n'));
}

// ---------- commands ----------

function parseArgs(argv) {
  const flags = { json: false, full: false, desk: undefined, values: {}, where: undefined };
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') flags.json = true;
    else if (a === '--full') flags.full = true;
    else if (a === '--expect-rows') flags.expectRows = true;
    else if (a === '--desk') flags.desk = argv[++i];
    else if (a === '--where') flags.where = argv[++i];
    else if (a === '--every' || a === '--max') flags[a.slice(2)] = argv[++i] ?? fail(`${a} needs a time, such as 30s or 25m`);
    else if (a === '--limit' || a === '--key') flags[a.slice(2)] = argv[++i] ?? fail(`${a} needs a value`);
    else if (a === '--mailbox') flags.mailbox = [...(flags.mailbox ?? []), argv[++i] ?? fail('--mailbox needs an address')];
    else if (a === '-a' || a === '--arg') {
      const kv = argv[++i] ?? '';
      const eq = kv.indexOf('=');
      if (eq < 1) fail(`-a needs name=value, got "${kv}"`);
      const name = kv.slice(0, eq);
      let value = kv.slice(eq + 1);
      if (value.startsWith('@')) {
        const file = path.resolve(value.slice(1));
        if (!fs.existsSync(file)) fail(`-a ${name}=@${value.slice(1)}: no such file`);
        value = fs.readFileSync(file, 'utf8');
      } else if (/^-?(0|[1-9]\d{0,14})$/.test(value)) value = Number(value);
      flags.values[name] = value;
    } else rest.push(a);
  }
  return { flags, rest };
}

function sha(text) {
  return crypto.createHash('sha256').update(text).digest('hex').slice(0, 16);
}

// A desk is a folder in desks/ with a desk.md. Its header lines before the first ##
// can say Headline:, Target:, Needs: (env var names, comma separated) and Mail: (the
// addresses the desk answers, comma separated).
function desksOnDisk() {
  return fs.readdirSync(DESKS, { withFileTypes: true })
    .filter((d) => d.isDirectory() && fs.existsSync(path.join(DESKS, d.name, 'desk.md')))
    .map((d) => {
      const dir = path.join(DESKS, d.name);
      const md = fs.readFileSync(path.join(dir, 'desk.md'), 'utf8');
      const head = md.split(/^## /m)[0];
      const field = (k) => head.match(new RegExp(`^${k}:\\s*(.+)$`, 'mi'))?.[1].trim();
      return {
        name: d.name,
        dir,
        title: md.match(/^#\s+(.+)$/m)?.[1].trim() || d.name,
        headline: field('Headline'),
        target: field('Target'),
        needs: (field('Needs') || '').split(/[,\s]+/).filter((x) => /^[A-Z][A-Z0-9_]*$/.test(x)),
        mail: [...new Set((field('Mail') || '').toLowerCase().split(/[,\s]+/).filter((x) => /^[^@<>]+@[^@<>]+\.[^@<>]+$/.test(x)))],
      };
    });
}

// Addresses in more than one desk's Mail: line, with the desks that claim them.
function mailClashes(desks) {
  const owners = new Map();
  for (const d of desks) for (const a of d.mail) owners.set(a, [...(owners.get(a) || []), d.name]);
  return [...owners].filter(([, names]) => names.length > 1);
}

// --desk, or the only desk there is.
function deskOf(flags) {
  if (flags.desk) return flags.desk;
  const all = desksOnDisk();
  return all.length === 1 ? all[0].name : null;
}

function migrationFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
}

// Keeps the database, the settings, and what wrangler and npm leave (the mail Worker's
// .dev.vars holds its token) out of git. bin/kit.mjs calls it too.
export function ensureGitignore(desks = DESKS) {
  const file = path.join(desks, '.gitignore');
  const want = ['data', '.env', 'node_modules', '.wrangler', '.dev.vars'];
  const have = fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split(/\r?\n/) : [];
  const missing = want.filter((w) => !have.includes(w));
  if (missing.length) fs.appendFileSync(file, `${have.length && have.at(-1) !== '' ? '\n' : ''}${missing.join('\n')}\n`);
}

async function init(flags) {
  ensureGitignore();
  const db = await open();
  const me = USER || 'setup';
  const done = [];
  const core = fs.readFileSync(path.join(KIT, 'core.sql'), 'utf8');
  await execute(db, core, {});
  await execute(db, `INSERT INTO migrations(name, checksum, by) VALUES ('core/core.sql', :c, :by)
    ON CONFLICT(name) DO UPDATE SET checksum = excluded.checksum, applied_at = excluded.applied_at, by = excluded.by`,
  { c: sha(core), by: me });
  const applied = new Set((await execute(db, 'SELECT name FROM migrations')).results[0].rows.map((r) => r[0]));
  for (const f of migrationFiles(path.join(KIT, 'migrations'))) {
    if (applied.has(`core/${f}`)) continue;
    const text = fs.readFileSync(path.join(KIT, 'migrations', f), 'utf8');
    await execute(db, `${text};\nINSERT INTO migrations(name, checksum, by) VALUES (:n, :c, :by);`, { n: `core/${f}`, c: sha(text), by: me });
    done.push(`core/${f}`);
  }
  for (const desk of desksOnDisk()) {
    await execute(db, `INSERT INTO desks(name, title, headline, target) VALUES (:name, :title, :headline, :target)
      ON CONFLICT(name) DO UPDATE SET title = excluded.title, headline = excluded.headline, target = excluded.target`,
    { name: desk.name, title: desk.title, headline: desk.headline ?? null, target: desk.target ?? null });
    const schemaFile = path.join(desk.dir, 'schema.sql');
    if (fs.existsSync(schemaFile)) {
      const text = fs.readFileSync(schemaFile, 'utf8');
      await execute(db, text, {});
      await execute(db, `INSERT INTO migrations(name, checksum, by) VALUES (:n, :c, :by)
        ON CONFLICT(name) DO UPDATE SET checksum = excluded.checksum, applied_at = excluded.applied_at, by = excluded.by`,
      { n: `${desk.name}/schema.sql`, c: sha(text), by: me });
    }
    for (const f of migrationFiles(path.join(desk.dir, 'migrations'))) {
      if (applied.has(`${desk.name}/${f}`)) continue;
      const text = fs.readFileSync(path.join(desk.dir, 'migrations', f), 'utf8');
      await execute(db, `${text};\nINSERT INTO migrations(name, checksum, by) VALUES (:n, :c, :by);`, { n: `${desk.name}/${f}`, c: sha(text), by: me });
      done.push(`${desk.name}/${f}`);
    }
  }
  const { results } = await execute(db, "SELECT name FROM desks ORDER BY name; SELECT count(*) FROM sqlite_schema WHERE type = 'table'");
  const names = results[0].rows.map((r) => r[0]);
  console.log(`Database ready: ${db.where} (${HOSTED ? 'hosted' : 'this machine'}), ${results[1].rows[0][0]} tables.`);
  console.log(names.length ? `Desks: ${names.join(', ')}.` : 'No desks yet: a desk is a folder in desks/ with a desk.md.');
  if (done.length) console.log(`Applied: ${done.join(', ')}.`);
  if (!USER) console.log('Set DESK_USER=<your name> in desks/.env so your work is recorded as yours.');
  db.close();
}

async function status(flags, deskName) {
  const db = await open();
  const desk = deskName ?? flags.desk ?? null;
  const v = { ...autoParams(), d: desk, me: USER ?? '' };
  const f = (alias = '') => `(:d IS NULL OR ${alias}desk = :d)`;
  const { results } = await execute(db, `
    SELECT desk, waiting, due, in_flight, uncertain, locks, headline, value, previous, target, last_activity
      FROM board WHERE ${f()} ORDER BY desk;
    SELECT id, desk, kind, about, title, why_human, version FROM waiting WHERE ${f()} ORDER BY id;
    SELECT type, id, desk, owner, about, what, due FROM due WHERE ${f()} ORDER BY due IS NULL, due, id;
    SELECT id, desk, kind, about, status, mode, sent_by, hours FROM in_flight WHERE ${f()} ORDER BY id;
    SELECT key, by, desk, doing, hours FROM held WHERE ${f()} ORDER BY by = :me DESC, at;
    SELECT id, coalesce(desk, 'all') AS desk, about, topic, reason, until FROM active_holds WHERE desk IS NULL OR ${f()} ORDER BY id DESC;
    SELECT desk, kind, channel, identity, stage FROM trust_board WHERE ${f()} ORDER BY desk, kind;
    SELECT id, coalesce(desk, 'all') AS desk, kind, lesson FROM lessons
      WHERE (desk IS NULL OR ${f()}) AND id NOT IN (SELECT replaces FROM lessons WHERE replaces IS NOT NULL)
      ORDER BY id DESC LIMIT 10;
  `, v);
  if (flags.json) {
    const names = ['board', 'waiting', 'due', 'in_flight', 'locks', 'holds', 'trust', 'lessons'];
    console.log(JSON.stringify(Object.fromEntries(results.map((r, i) => [names[i], asObjects(r.cols, r.rows)])), null, 2));
    db.close();
    return;
  }
  const [board, waiting, due, flight, locks, holds, trust, lessons] = results;
  console.log(`${HOSTED ? 'Hosted' : 'Local'} database ${db.where}, you are ${USER ?? '(DESK_USER not set)'}.`);
  if (!board.rows.length) console.log(desk ? `No desk called ${desk}: run init after adding desks/${desk}/desk.md.` : 'No desks yet.');
  for (const r of board.rows) {
    const [name, w, d, fl, u, l, headline, value, previous, target] = r;
    const bits = [`${w} waiting`, `${d} due`, `${fl} in flight`];
    if (u) bits.push(`${u} UNCERTAIN`);
    if (l) bits.push(`${l} locked`);
    let line = `${name}: ${bits.join(' · ')}`;
    if (headline) line += ` · ${headline} ${value ?? 'not measured yet'}${previous !== null && previous !== undefined ? ` (was ${previous})` : ''}`;
    if (target) line += ` · target ${target}`;
    console.log(line);
  }
  // Long lists show their first rows and say how to see the rest. --json has them all.
  const section = (title, r, limit, rest) => {
    if (!r.rows.length) return;
    const more = limit && r.rows.length > limit ? r.rows.length - limit : 0;
    const rows = more ? r.rows.slice(0, limit) : r.rows;
    console.log(`\n${title}\n${table(r.cols, rows)}${more ? `\n... and ${more} more: node desks/desk.mjs sql "${rest}"` : ''}`);
  };
  const where = desk ? ` WHERE desk = '${desk.replace(/'/g, "''")}'` : '';
  section('Waiting for a person', waiting);
  section('Due', due, 20, `SELECT * FROM due${where}`);
  section('In flight (sending for more than a few minutes: check the provider before anything else)', flight);
  section('Locks', locks);
  section(`Holds (${holds.rows.length}, newest first)`, holds, 10, `SELECT * FROM active_holds${desk ? ` WHERE desk IS NULL OR desk = '${desk.replace(/'/g, "''")}'` : ''}`);
  section('Trust', trust);
  section('Recent lessons', lessons);
  db.close();
}

async function lock(flags, key, doing) {
  if (!key || !doing) fail('usage: desk.mjs lock <key> "<what you are doing>"');
  if (!USER) fail('set DESK_USER in desks/.env first, so the lock says who has it');
  const db = await open();
  const { results } = await execute(db, `
    INSERT INTO locks(key, by, desk, doing) VALUES (:key, :me, :desk, :doing)
      ON CONFLICT(key) DO UPDATE SET doing = excluded.doing, desk = coalesce(excluded.desk, locks.desk),
        at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE locks.by = excluded.by;
    SELECT by, doing, at, desk FROM locks WHERE key = :key;`, { ...autoParams(), key, doing, desk: deskOf(flags) });
  const [by, was, at] = results[1].rows[0];
  db.close();
  if (by === USER) {
    console.log(`Locked ${key}: ${doing}.`);
    return 0;
  }
  console.log(`${key} is held by ${by} since ${at} (${was}). Leave it, or take it over with: node desks/desk.mjs take ${JSON.stringify(key)} "<what you are doing>"`);
  return 2;
}

async function unlock(flags, key) {
  if (!key) fail('usage: desk.mjs unlock <key>');
  const db = await open();
  const { results } = await execute(db, 'DELETE FROM locks WHERE key = :key AND by = :me; SELECT by FROM locks WHERE key = :key;', { ...autoParams(), key });
  db.close();
  if (results[0].changes) console.log(`Unlocked ${key}.`);
  else if (results[1].rows.length) { console.log(`${key} is held by ${results[1].rows[0][0]}, not you: left as it is.`); return 2; }
  else console.log(`${key} was not locked.`);
  return 0;
}

async function take(flags, key, doing) {
  if (!key || !doing) fail('usage: desk.mjs take <key> "<what you are doing>"');
  if (!USER) fail('set DESK_USER in desks/.env first');
  const db = await open();
  const v = { ...autoParams(), key, doing, desk: deskOf(flags) };
  const { results } = await execute(db, `
    SELECT by, doing, at FROM locks WHERE key = :key;
    UPDATE locks SET by = :me, doing = :doing, desk = coalesce(:desk, desk), at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
      WHERE key = :key;
    INSERT OR IGNORE INTO locks(key, by, desk, doing) VALUES (:key, :me, :desk, :doing);`, v);
  db.close();
  const before = results[0].rows[0];
  if (!before) console.log(`${key} was free: locked it for you (${doing}).`);
  else if (before[0] === USER) console.log(`You already had ${key}: now ${doing}.`);
  else console.log(`Took ${key} from ${before[0]}, who had it since ${before[2]} (${before[1]}). It's in the log.`);
  return 0;
}

// ---------- mail: the desk's listener ----------

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const retryable = (msg) => Object.assign(new DeskError(msg), { retry: true });
const ago = (ms) => (ms >= 60000 ? `${Math.round(ms / 60000)} min` : `${Math.round(ms / 1000)}s`);

// Text from outside (an id, an address), made safe to print as one word on one line.
const oneWord = (s) => String(s ?? '').replace(/[\s\p{C}]/gu, '').slice(0, 200);
const line1 = (s) => String(s ?? '').replace(/[\s\p{C}]+/gu, ' ').trim();
const address = (s) => oneWord(String(s ?? '').match(/<([^<>\s]+@[^<>\s]+)>/)?.[1] ?? s);

function duration(text, fallback, flag) {
  if (text === undefined) return fallback;
  const m = String(text).match(/^(\d+(?:\.\d+)?)(ms|s|m|h)?$/);
  const ms = m && Number(m[1]) * { ms: 1, s: 1000, m: 60000, h: 3600000 }[m[2] || 's'];
  if (!ms) fail(`${flag} takes a time such as 30s, 5m or 1h, not "${text}"`);
  return ms;
}

function mailSettings() {
  const missing = [['DESK_MAIL_URL', MAIL_URL, "<the mail Worker's address>"], ['DESK_MAIL_TOKEN', MAIL_TOKEN, "<the Worker's MAIL_API_TOKEN>"]]
    .filter(([, v]) => !v).map(([n, , what]) => `${n}=${what}`);
  if (missing.length) fail(`set ${missing.join(' and ')} in desks/.env (kit/mail/README.md)`);
  if (!/^https?:\/\/[^/]/.test(MAIL_URL)) fail(`DESK_MAIL_URL should start with https:// (it's the mail Worker's address), not "${MAIL_URL}"`);
  if (!/^[a-z][a-z0-9-]*$/.test(MAIL_PREFIX)) fail(`DESK_MAIL_PREFIX is the one word inbox ids for mail start with, such as mail or acme-mail, not "${line1(MAIL_PREFIX)}"`);
}

// One request to the project's mail Worker (kit/mail/README.md): its HTTP status and its
// answer, parsed (json is null when it isn't JSON). No answer at all throws, retryable.
async function mailFetch(method, route, { query = [], body, timeout = 20000 } = {}) {
  const url = new URL(MAIL_URL + route);
  for (const [k, v] of query) url.searchParams.append(k, v);
  let res, text;
  try {
    res = await fetch(url, {
      method,
      headers: { authorization: `Bearer ${MAIL_TOKEN}`, ...(body ? { 'content-type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      redirect: 'manual',
      signal: AbortSignal.timeout(timeout),
    });
    text = await res.text();
  } catch (e) {
    const why = e.cause?.code || e.name;
    throw Object.assign(retryable(`could not reach the mail Worker at ${url.host} (${why})`), { why });
  }
  let json = null;
  try { json = JSON.parse(text); } catch {}
  return { status: res.status, json, text, host: url.host, location: res.headers.get('location') };
}

const said = (json, text) => line1(json?.error?.message ?? json?.error ?? json?.message ?? text).slice(0, 300);
// What the Worker said when it refused for certain, so nothing went: one of its own codes
// on a 4xx, or Email Sending's refusal (502 SEND_FAILED). Null for any other answer.
const refusal = ({ status, json }) => (typeof json?.error === 'string' && json.code
  && ((status >= 400 && status < 500 && status !== 408) || (status === 502 && json.code === 'SEND_FAILED')) ? said(json) : null);

// A request whose answer we need. A refused token or a request the Worker can't serve
// stops at once; no answer, a 5xx or a 429 may pass, so it's retryable.
async function mailCall(method, route, options) {
  const answer = await mailFetch(method, route, options);
  const { status, json, text, host, location } = answer;
  if (status === 401 || status === 403) {
    fail(`the mail Worker at ${host} refused DESK_MAIL_TOKEN (${status}): set it to the Worker's MAIL_API_TOKEN in desks/.env`);
  }
  if (status >= 300 && status < 400) fail(`the mail Worker at ${host} redirects to ${line1(location)}: set DESK_MAIL_URL to that address`);
  // The Worker's own refusals carry a code: refused says what it said.
  const refused = refusal(answer);
  if (refused) throw Object.assign(new DeskError(`the mail Worker at ${host} answered ${status} to ${route} (${refused})`), { refused });
  if (status >= 500 || status === 408 || status === 429) throw retryable(`the mail Worker at ${host} answered ${status}`);
  if (status < 200 || status >= 300) {
    fail(`the mail Worker at ${host} answered ${status} to ${route} (${said(json, text)}): check DESK_MAIL_URL is the desk mail Worker (kit/mail/README.md) and the desk's Mail: line`);
  }
  if (json === null) throw retryable(`the mail Worker at ${host} answered something that isn't JSON`);
  return json;
}
const mailGet = (route, query) => mailCall('GET', route, { query });

// The desk with that name, which must have a Mail: line.
function mailDesk(desks, name) {
  const desk = desks.find((d) => d.name === name);
  if (!desk) fail(`no desk called ${name}: a desk is a folder in desks/ with a desk.md`);
  if (!desk.mail.length) fail(`desks/${desk.name}/desk.md has no Mail: line: add "Mail: <address>" under its title, with the addresses this desk answers`);
  return desk;
}

// Waits, with no model calls, for mail to the desk's own addresses and for mail another
// desk handed over. Prints a line for each on stdout and exits 0, which wakes the session
// that started it; after --max with nothing, it says so and exits 0. Everything else goes
// to stderr. One person listens to a desk: the lock listen:<desk>.
async function watch(flags, deskName) {
  const name = deskName ?? deskOf(flags);
  if (!name) fail('usage: desk.mjs watch <desk>');
  const desks = desksOnDisk();
  const desk = mailDesk(desks, name);
  const clashes = mailClashes(desks).filter(([a]) => desk.mail.includes(a));
  if (clashes.length) {
    fail(`${clashes.map(([a, names]) => `${a} is in the Mail: line of ${names.join(' and ')}`).join('; ')}: an address belongs to one desk, so take it out of the others`);
  }
  mailSettings();
  if (!USER) fail('set DESK_USER in desks/.env first, so the lock says who is listening');
  const every = duration(flags.every, 30000, '--every');
  const max = duration(flags.max, 25 * 60000, '--max');
  const own = new Set(desk.mail);
  const mailboxes = desk.mail.map((a) => ['mailbox', a]);
  const key = `listen:${desk.name}`;
  const { host, pathname } = new URL(MAIL_URL);
  const source = `${host}${pathname.replace(/\/$/, '')} ${[...own].sort().join(',')}`;

  const q = (text, values) => query(text, { desk: desk.name, key, source, ...values });
  let fails = 0;
  const attempt = async (step) => {
    for (;;) {
      try { const out = await step(); fails = 0; return out; } catch (e) {
        if (!e.retry && !('unreached' in e)) throw e;
        if (++fails >= 3) fail(`${e.message}, ${fails} times in a row: stopped listening`);
        console.error(`${e.message}: trying again in ${ago(every)} (${fails} of 3)`);
        await sleep(every);
      }
    }
  };

  const [ready] = await q(`SELECT (SELECT count(*) FROM sqlite_schema WHERE name = 'mail_cursors'),
    (SELECT count(*) FROM desks WHERE name = :desk)`);
  if (!ready.rows[0][0]) fail('the database is older than the kit: run node desks/desk.mjs init');
  if (!ready.rows[0][1]) fail(`${desk.name} is not in the database yet: run node desks/desk.mjs init`);
  const [, held, saved] = await q(`
    INSERT INTO locks(key, by, desk, doing) VALUES (:key, :me, :desk, 'listening for mail')
      ON CONFLICT(key) DO UPDATE SET doing = excluded.doing, desk = excluded.desk,
        at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE locks.by = excluded.by;
    SELECT by, at FROM locks WHERE key = :key;
    SELECT cursor, source, handed_over, checked_at FROM mail_cursors WHERE desk = :desk;`);
  const [holder, since] = held.rows[0];
  if (holder !== USER) {
    const checked = saved.rows[0]?.[3];
    console.error(`${holder} is listening to ${desk.name} (since ${since}${checked ? `, last checked ${checked}` : ''}). Leave it, or take it over with: node desks/desk.mjs take ${key} "listening for mail"`);
    return 2;
  }

  // Handovers: open email inbox rows for this desk that came to an address it doesn't own.
  // handed_over keeps the ones already announced that are still open.
  const handovers = `SELECT id, mailbox, from_addr FROM inbox WHERE desk = :desk AND channel = 'email'
    AND handled_at IS NULL AND lower(mailbox) NOT IN (SELECT value FROM json_each(:own)) ORDER BY received_at, id`;
  const ownJson = JSON.stringify([...own]);
  let [after, was, announced] = saved.rows[0] ?? [];
  if (was !== source) {
    console.error(was ? `${desk.name}'s addresses or mail Worker changed: listening from now.` : `First time listening for ${desk.name}: from now on.`);
    const page = await attempt(() => mailGet('/v1/changes', [...mailboxes, ['after', 'latest']]));
    if (page?.cursor == null) fail(`the mail Worker at ${host} gave no cursor for after=latest: is it the desk mail Worker? (kit/mail/README.md)`);
    const [, row] = await attempt(() => q(`
      INSERT INTO mail_cursors(desk, source, cursor, handed_over, by)
        VALUES (:desk, :source, :cursor, (SELECT json_group_array(id) FROM (${handovers})), :me)
        ON CONFLICT(desk) DO UPDATE SET source = excluded.source, cursor = excluded.cursor,
          checked_at = excluded.checked_at, by = excluded.by;
      SELECT cursor, handed_over FROM mail_cursors WHERE desk = :desk;`, { cursor: String(page.cursor), own: ownJson }));
    [after, announced] = row.rows[0];
  }

  // One look: new mail from the Worker (a full page may mean more), then handovers. The
  // cursor and the handovers announced are saved together before anything is printed.
  const poll = async () => {
    let next = after;
    const mail = [];
    for (let pages = 0; pages < 100; pages++) {
      const page = await mailGet('/v1/changes', [...mailboxes, ['after', next], ['limit', '50']]);
      if (page?.cursor == null || !Array.isArray(page.messages)) throw retryable(`the mail Worker at ${host} answered without a cursor and messages`);
      mail.push(...page.messages.filter((m) => own.has(String(m?.mailbox).toLowerCase())));
      const moved = String(page.cursor) !== next;
      next = String(page.cursor);
      if (page.messages.length < 50 || !moved) break;
    }
    const [open] = await q(`${handovers};
      UPDATE mail_cursors SET cursor = :next, checked_at = :now, by = :me,
        handed_over = (SELECT json_group_array(id) FROM (${handovers})) WHERE desk = :desk;`, { next, own: ownJson });
    const seen = new Set(JSON.parse(announced));
    after = next;
    announced = JSON.stringify(open.rows.map((r) => r[0]));
    return { mail, handed: open.rows.filter((r) => !seen.has(r[0])) };
  };

  const line = flags.json
    ? (o) => JSON.stringify(o)
    : (o) => `${o.event} ${o.id} from ${o.from} to ${o.mailbox}${o.auto ? ', automatic' : ''}`;
  console.error(`Listening for mail to ${[...own].join(', ')} (${desk.name}): every ${ago(every)}, for up to ${ago(max)}.`);
  const deadline = Date.now() + max;
  for (;;) {
    const { mail, handed } = await attempt(poll);
    const events = [
      ...mail.map((m) => {
        return { event: 'mail', desk: desk.name, id: inboxId(m), mailbox: oneWord(m.mailbox).toLowerCase(),
          from: address(m.from) || 'unknown', auto: m.auto === true || m.auto === 1 };
      }),
      ...handed.map(([id, mailbox, from]) => ({ event: 'handover', desk: desk.name, id: oneWord(id), mailbox: oneWord(mailbox), from: address(from) || 'unknown' })),
    ];
    if (events.length) {
      for (const e of events) console.log(line(e));
      return 0;
    }
    if (Date.now() + every > deadline) {
      console.log(flags.json ? JSON.stringify({ event: 'quiet', desk: desk.name, waited: ago(max) }) : `no new mail for ${desk.name} in ${ago(max)}`);
      return 0;
    }
    await sleep(every);
  }
}

// ---------- mail: reading and sending through the Worker ----------

// The inbox's id for an email, mail:<mailbox>:<id>, and the Worker's own id: both work.
// A thread id may carry the mail: prefix too (mail:5d1e). DESK_MAIL_PREFIX changes the word.
const mailId = (id) => String(id ?? '').replace(new RegExp(`^${MAIL_PREFIX}:(?:[^:]*:)?`), '');
const inboxId = (m) => `${MAIL_PREFIX}:${oneWord(m.mailbox).toLowerCase()}:${oneWord(m.id) || 'unknown'}`;
// An email's text with its lines kept and anything that could drive a terminal taken out.
const mailText = (s) => String(s ?? '').replace(/\r\n?/g, '\n').replace(/[^\P{C}\n\t]/gu, '');
const when = (iso) => String(iso ?? '').replace('T', ' ').slice(0, 16);
const addresses = (list) => (list ?? []).map(address).join(', ');

function mailNotes(m) {
  const notes = [m.direction === 'out' && (m.error ? `${m.status}: ${line1(m.error)}` : m.status),
    m.auto && 'automatic', m.own && 'own copy', m.key && `key ${line1(m.key)}`].filter(Boolean);
  return notes.length ? ` (${notes.join(', ')})` : '';
}

function mailList({ messages }) {
  if (!messages.length) return '(no mail)';
  return messages.map((m) => {
    const who = m.direction === 'out' ? `to ${addresses(m.to)}` : `from ${address(m.from)}`;
    const about = [line1(m.subject) || '(no subject)', line1(m.snippet)].filter(Boolean).join(' · ');
    return `${when(m.created_at)}  ${inboxId(m)}  ${who}${mailNotes(m)}\n  ${about}`;
  }).join('\n');
}

function mailRead(m) {
  const head = [
    ['id', inboxId(m)],
    ['thread', oneWord(m.thread)],
    ['from', m.from_name ? `${line1(m.from_name)} <${address(m.from)}>` : address(m.from)],
    ['to', addresses(m.to)],
    ['cc', addresses(m.cc)],
    ['bcc', addresses(m.bcc)],
    ['subject', line1(m.subject)],
    ['date', `${line1(m.created_at)}${mailNotes(m)}`],
    ['files', (m.attachments ?? []).map((f) => `${line1(f.filename) || 'unnamed'} (${line1(f.type)}, ${f.size} bytes)`).join(', ')],
  ].filter(([, v]) => v);
  return `${records(head.map(([k]) => k), [head.map(([, v]) => v)])}\n\n${mailText(m.text).trim()}`;
}

function mailThread({ thread, messages }) {
  const top = `Thread ${oneWord(thread)}: ${line1(messages[0]?.subject) || '(no subject)'}, ${messages.length} email${messages.length === 1 ? '' : 's'}`;
  return [top, ...messages.map((m) => `--- ${when(m.created_at)}  ${inboxId(m)}  from ${address(m.from)} to ${addresses(m.to)}${mailNotes(m)}\n\n${mailText(m.fresh || m.text).trim()}`)].join('\n\n');
}

function mailStatus(s) {
  const caps = Object.entries(s.caps ?? {}).map(([name, c]) => `${name.replaceAll('_', ' ')} ${c.used} of ${c.limit} (${c.setting})`);
  const inbox = Object.entries(s.inbox ?? {}).map(([box, n]) => `${box} ${n.today} today, ${n.total} in all`);
  return [
    `Mailboxes: ${(s.mailboxes ?? []).join(', ') || 'none'}`,
    `Sends as: ${Object.entries(s.senders ?? {}).map(([a, n]) => (n ? `${n} <${a}>` : a)).join(', ') || 'nobody: SENDERS is empty'}`,
    `Copies go to: ${(s.forward_to ?? []).join(', ') || 'nobody'}`,
    `Sends: ${caps.join('; ')}`,
    `Received: ${inbox.join('; ') || 'nothing yet'}`,
  ].join('\n');
}

// The mailboxes a list reads: --mailbox, else the addresses of --desk, or of the only desk
// that answers mail. With no such desk, every mailbox; with several, say which.
function mailboxQuery(flags) {
  if (flags.mailbox) return flags.mailbox.map((a) => ['mailbox', a]);
  const desks = desksOnDisk();
  const answering = desks.filter((d) => d.mail.length);
  if (!flags.desk && answering.length > 1) fail(`say whose mail: --desk ${answering.map((d) => d.name).join(' or --desk ')}, or --mailbox <address>`);
  const desk = flags.desk ? mailDesk(desks, flags.desk) : answering[0];
  return (desk?.mail ?? []).map((a) => ['mailbox', a]);
}

async function mail(flags, [cmd, ...args]) {
  mailSettings();
  const show = (answer, text) => { console.log(flags.json ? JSON.stringify(answer, null, 2) : text(answer)); return 0; };
  const limit = flags.limit === undefined ? [] : [['limit', String(flags.limit)]];
  const list = async (query, scope = mailboxQuery(flags)) => show(await mailGet('/v1/messages', [...scope, ...query, ...limit]), mailList);
  const usage = (what) => fail(`usage: desk.mjs mail ${cmd} ${what}`);
  switch (cmd) {
    case 'inbox': return list([['direction', 'in'], ['own', '0']]);
    // A key belongs to one action, so it needs no desk.
    case 'sent': return flags.key ? list([['direction', 'out'], ['key', flags.key]], []) : list([['direction', 'out']]);
    case 'search':
      if (!args.length) usage('<text>');
      return list([['q', args.join(' ')]]);
    case 'read':
      if (!args[0]) usage('<id>');
      return show(await mailGet(`/v1/messages/${encodeURIComponent(mailId(args[0]))}`), mailRead);
    case 'thread':
      if (!args[0]) usage('<thread id, or the id of an email in it>');
      return show(await mailGet(`/v1/threads/${encodeURIComponent(mailId(args[0]))}`), mailThread);
    case 'status': return show(await mailGet('/v1/status'), mailStatus);
    case 'suppressions':
      return show(await mailGet('/v1/suppressions'), ({ suppressions }) => table(['address', 'reason', 'since'],
        suppressions.map((s) => [s.address, line1(s.reason), when(s.created_at)])));
    case 'suppress':
      if (!args[0] || !args[1]) usage('<address> "<reason>"');
      return show(await mailCall('POST', '/v1/suppressions', { body: { address: args[0], reason: args.slice(1).join(' ') } }),
        (d) => `The mail Worker will never send to ${d.address} (${line1(d.reason)}).`);
    default:
      fail('usage: desk.mjs mail inbox|read <id>|thread <id>|search <text>|sent|status|suppress <address> "<reason>"|suppressions');
  }
}

// The email an action sends: exactly the stored version, from the desk's own address. Anything
// that can't go as stored stops here.
const EMAIL_PAYLOAD = new Set(['cc', 'bcc', 'reply_to', 'thread']);
function emailFor(a, stop) {
  const desk = desksOnDisk().find((d) => d.name === a.desk);
  if (!desk) stop(`belongs to ${a.desk}, which has no folder in desks/ here`);
  if (!desk.mail.includes(String(a.identity).toLowerCase())) {
    stop(`is from ${a.identity}, which isn't in ${a.desk}'s Mail: line (${desk.mail.join(', ') || 'none'}): a desk sends as its own addresses`);
  }
  const to = String(a.target).match(/^email:(.+)$/)?.[1];
  if (!to) stop(`goes to ${a.target}: an email goes to email:<address>`);
  const p = JSON.parse(a.payload);
  if (!p || typeof p !== 'object' || Array.isArray(p)) stop("has a payload that isn't a JSON object");
  const other = Object.keys(p).filter((k) => !EMAIL_PAYLOAD.has(k));
  if (other.length) stop(`has payload.${other.join(', payload.')}, which the mail Worker can't send: it sends text, with cc, bcc and reply_to`);
  if (p.reply_to !== undefined && typeof p.reply_to !== 'string') stop("has payload.reply_to that isn't the id of an email");
  const email = { key: a.key, from: a.identity, to: [to], subject: a.title, text: a.body, approved: true };
  for (const k of ['cc', 'bcc']) if (p[k] !== undefined) email[k] = p[k];
  if (p.reply_to) email.reply_to = mailId(p.reply_to);
  return email;
}

// What the Worker's answer to a send means: sent, with its id; failed, when it refused for
// certain; uncertain, for anything else.
function sendOutcome(answer) {
  const { status, json } = answer;
  if (status >= 200 && status < 300 && json?.status === 'sent' && typeof json.id === 'string' && /^[\w-]{1,100}$/.test(json.id)) {
    return { status: 'sent', ref: `${MAIL_PREFIX}:${json.id}`, result: null };
  }
  const refused = refusal(answer);
  if (refused) return { status: 'failed', ref: null, result: `the mail Worker refused it: ${refused}` };
  return { status: 'uncertain', ref: null, result: answer.lost ?? `the mail Worker answered ${status}${json ? `: ${said(json)}` : " with something that isn't JSON"}` };
}

// Sends one email action through the Worker: the Worker checks it, the database claims
// it, the Worker sends exactly the stored version, and the answer is recorded at once. It
// never retries: a send that might have gone is uncertain, and is settled by looking.
async function send(flags, idText) {
  const id = Number(idText);
  if (!Number.isSafeInteger(id) || id < 1) fail('usage: desk.mjs send <action id>');
  mailSettings();
  if (!USER) fail('set DESK_USER in desks/.env first, so the send says who sent it');
  const action = async () => {
    const [found] = await query('SELECT desk, key, channel, identity, target, title, body, payload, status, sent_by, provider_ref FROM actions WHERE id = :id', { id });
    return asObjects(found.cols, found.rows)[0];
  };
  const a = await action();
  if (!a) fail(`no action ${id}`);
  const stop = (why) => fail(`not sent: action ${id} ${why}`);
  const look = `look with node desks/desk.mjs mail sent --key '${a.key}'`;

  // What the database will be asked, and what it can't be asked at all.
  if (a.channel !== 'email') stop(`goes out by ${a.channel}, not email: send it with the desk's own tool`);
  const mode = { approved: 'human', draft: 'auto' }[a.status];
  if (!mode) {
    stop({
      waiting: 'is waiting for a person: show it and ask',
      sending: `is being sent by ${a.sent_by}. If that stopped mid-way, ${look} and settle it (together.md)`,
      sent: `was sent already (${a.provider_ref})`,
      verified: `was sent already (${a.provider_ref})`,
      uncertain: `might have gone already, so it is never sent again: ${look}, then settle it as sent or failed`,
      failed: 'failed, and that is final: a new try is a new action with a new key',
    }[a.status] ?? `is ${a.status}`);
  }
  const email = emailFor(a, stop);

  // Right before the claim, the Worker checks it as it would send it: sender, addresses,
  // key, never-contact list, caps, and nobody writing again after the email it answers.
  const checked = await mailCall('POST', '/v1/send', { body: { ...email, check: true } }).catch((e) => {
    if (e.refused) stop(`stays ${a.status}: the mail Worker would refuse it: ${e.refused}`);
    throw e;
  });
  if (checked.check !== true) {
    stop(`stays ${a.status}, but the mail Worker didn't answer as a check, so it may have sent it: ${look}. send needs the kit's mail Worker (kit/mail/README.md)`);
  }
  if (checked.subject !== a.title) stop(`would go out with the subject "${line1(checked.subject)}": make that the title and show it again`);

  // The claim. The database decides: approved, held, locked, trusted, spot check.
  let claimed;
  try {
    [claimed] = await query(`UPDATE actions SET status = 'sending', mode = :mode, sent_by = :me, last_by = :me
      WHERE id = :id AND status = :was RETURNING id`, { id, mode, was: a.status });
  } catch (e) {
    if (!(e instanceof DeskError)) throw e;
    // A hosted database can take the claim and lose the answer: say so if it did.
    const now = await action().catch(() => null);
    const taken = now?.status === 'sending' && now.sent_by === USER;
    fail(`not sent: ${e.message}${taken ? ` It shows as being sent by you, though nothing went: set it to failed with result 'not sent: the claim was lost'.` : ''}`);
  }
  if (!claimed.rows.length) stop('changed while it was being sent: read it again');

  let answer;
  try { answer = await mailFetch('POST', '/v1/send', { body: email, timeout: 60000 }); } catch (e) { answer = { lost: `no answer from the mail Worker (${e.why})` }; }
  const outcome = sendOutcome(answer);

  // Recorded at once. If the database can't take it, say exactly what to record.
  const what = outcome.status === 'sent' ? `SENT (${outcome.ref})` : outcome.status.toUpperCase();
  const record = `node desks/desk.mjs sql "UPDATE actions SET status = '${outcome.status}', provider_ref = ${literal(outcome.ref)}, last_by = :me WHERE id = ${id}"`;
  let recorded;
  for (let tries = 1; !recorded; tries++) {
    try {
      [recorded] = await query(`UPDATE actions SET status = :status, provider_ref = :ref, result = :result, last_by = :me
        WHERE id = :id AND status = 'sending' RETURNING id`, { id, ...outcome });
    } catch (e) {
      // Only a database that didn't answer is worth asking again.
      if (tries >= 3 || !(e.retry || 'unreached' in e)) {
        fail(`${what}, but the database didn't take the record (${e.message}). Record it before anything else: ${record}`);
      }
      await sleep(1000);
    }
  }
  if (!recorded.rows.length) {
    // A retry finds it recorded when a hosted database took the first try and lost the answer.
    const now = await action().catch(() => null);
    if (now?.status !== outcome.status || now.provider_ref !== outcome.ref) {
      fail(`${what}, but #${id} was changed while it was being sent, so this wasn't recorded. Read it, and record it by hand: ${record}`);
    }
  }

  if (flags.json) console.log(JSON.stringify({ action: id, status: outcome.status, provider_ref: outcome.ref, result: outcome.result, key: a.key }));
  else if (outcome.status === 'sent') {
    console.log(`Sent #${id} to ${[email.to[0], ...(email.cc ?? [])].join(', ')} as ${a.identity}: recorded as sent (${outcome.ref}). It's in the thread: node desks/desk.mjs mail thread ${outcome.ref}`);
  } else if (outcome.status === 'failed') {
    console.error(`Not sent: ${outcome.result}. Recorded #${id} as failed, which is final: a new try is a new action with a new key.`);
  } else {
    console.error(`Might have gone: ${outcome.result}. Recorded #${id} as uncertain, so it is never sent again: ${look}, then settle it as sent or failed.`);
  }
  return outcome.status === 'sent' ? 0 : 1;
}

function csv(cols, rows) {
  const q = (v) => {
    const s = cell(v);
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return `${[cols.map(q).join(','), ...rows.map((r) => r.map(q).join(','))].join('\n')}\n`;
}

async function exportTable(flags, name, file) {
  if (!name || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) fail('usage: desk.mjs export <table or view> [file.csv] [--where "..."]');
  const db = await open();
  const { results } = await execute(db, `SELECT * FROM ${name}${flags.where ? ` WHERE ${flags.where}` : ''}`, { ...autoParams(), ...flags.values });
  db.close();
  const out = csv(results[0].cols, results[0].rows);
  if (!file) { process.stdout.write(out); return 0; }
  fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  fs.writeFileSync(file, out);
  console.log(`Wrote ${results[0].rows.length} rows to ${file}.`);
  return 0;
}

const USER_OBJECTS = "name NOT LIKE 'sqlite_%' AND name NOT LIKE 'libsql_%' AND name <> 'desk_test_marker'";

function literal(v) {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : 'NULL';
  if (Buffer.isBuffer(v)) return `X'${v.toString('hex')}'`;
  return `'${String(v).replace(/'/g, "''")}'`;
}

// Tables, rows and indexes as SQL. Views and triggers are left out: init rebuilds them
// after a restore, so loading old rows never sets them off.
async function dump(flags, file) {
  const db = await open();
  const { results } = await execute(db, `SELECT type, name, sql FROM sqlite_schema
    WHERE sql IS NOT NULL AND type IN ('table', 'index') AND ${USER_OBJECTS} ORDER BY type = 'index', rowid`);
  const out = [`-- desk dump of ${db.where}, ${new Date().toISOString()}. Load with: node desks/desk.mjs restore <file>`,
    'PRAGMA foreign_keys = OFF;', 'BEGIN;'];
  let rows = 0;
  for (const [type, name, sql] of results[0].rows) {
    out.push(`${sql};`);
    if (type !== 'table') continue;
    const data = (await execute(db, `SELECT * FROM "${name.replace(/"/g, '""')}"`)).results[0];
    for (const r of data.rows) out.push(`INSERT INTO "${name}" VALUES (${r.map(literal).join(', ')});`);
    rows += data.rows.length;
  }
  out.push('COMMIT;', '');
  db.close();
  if (!file) { process.stdout.write(out.join('\n')); return 0; }
  fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true, mode: 0o700 });
  fs.writeFileSync(file, out.join('\n'), { mode: 0o600 });
  console.log(`Wrote ${results[0].rows.filter((r) => r[0] === 'table').length} tables and ${rows} rows to ${file}. It holds everything in the desk: keep it out of git.`);
  return 0;
}

async function restore(flags, file) {
  if (!file || !fs.existsSync(file)) fail('usage: desk.mjs restore <file from dump>, into an empty database');
  const db = await open();
  const { results } = await execute(db, `SELECT count(*) FROM sqlite_schema WHERE ${USER_OBJECTS}`);
  if (results[0].rows[0][0] > 0) fail(`${db.where} already has tables in it. Restore only into an empty database`);
  await execute(db, fs.readFileSync(file, 'utf8'), {});
  db.close();
  console.log(`Loaded ${file} into ${db.where}. Rebuilding views and triggers:`);
  return init(flags);
}

async function doctor() {
  const problems = [];
  const ok = (m) => console.log(`ok    ${m}`);
  const bad = (m) => { console.log(`fix   ${m}`); problems.push(m); };
  const note = (m) => console.log(`note  ${m}`);

  console.log(`Database: ${HOSTED ? DB : localPath(DB)} (${HOSTED ? 'hosted' : 'this machine'})`);
  if (MAIN !== ROOT) {
    note(`this is a worktree: settings and the local database come from the main checkout, ${MAIN}`);
    const data = path.join(DESKS, 'data');
    if (fs.existsSync(data) && !fs.lstatSync(data).isSymbolicLink()) {
      bad(`desks/data here is the worktree's own folder, so its files go when the worktree does: move them into ${path.join(MAIN, 'desks/data')} and remove it`);
    }
  }
  USER ? ok(`you are ${USER}`) : bad('DESK_USER is not set: put DESK_USER=<your name> in desks/.env');
  if (HOSTED && !TOKEN) bad('DESK_DB_TOKEN is not set: a hosted database needs its token in desks/.env');

  let db;
  try {
    db = await open();
    const t0 = Date.now();
    const { results } = await execute(db, "SELECT sqlite_version(), strftime('%Y-%m-%dT%H:%M:%fZ','now')");
    const [version, dbNow] = results[0].rows[0];
    ok(`connected in ${Date.now() - t0} ms, SQLite ${version}`);
    const skew = Math.abs(Date.parse(dbNow) - Date.now());
    if (skew > 120000) bad(`this machine's clock is ${Math.round(skew / 1000)}s away from the database's`);
  } catch (e) {
    bad(`cannot use the database: ${e.message}`);
  }

  if (db) {
    try {
      const { results } = await execute(db, 'PRAGMA quick_check');
      results[0].rows[0][0] === 'ok' ? ok('database file is sound') : bad(`database check: ${results[0].rows.map((r) => r[0]).join('; ')}`);
    } catch (e) {
      note(`could not run a file check here (${e.message})`);
    }
    let applied = new Map();
    try {
      const { results } = await execute(db, 'SELECT name, checksum FROM migrations');
      applied = new Map(results[0].rows);
    } catch {
      bad('the database has no desk tables yet: run node desks/desk.mjs init');
    }
    if (applied.size) {
      const core = fs.readFileSync(path.join(KIT, 'core.sql'), 'utf8');
      applied.get('core/core.sql') === sha(core) ? ok('core schema is current') : bad('the kit changed since the last init: run node desks/desk.mjs init');
      const known = new Set((await execute(db, 'SELECT name FROM desks')).results[0].rows.map((r) => r[0]));
      for (const desk of desksOnDisk()) {
        if (!known.has(desk.name)) { bad(`${desk.name}: not in the database yet: run init`); continue; }
        const schemaFile = path.join(desk.dir, 'schema.sql');
        if (fs.existsSync(schemaFile) && applied.get(`${desk.name}/schema.sql`) !== sha(fs.readFileSync(schemaFile, 'utf8'))) {
          bad(`${desk.name}: schema.sql changed since the last init: run init (a changed column needs a file in ${desk.name}/migrations/)`);
        }
        for (const f of migrationFiles(path.join(desk.dir, 'migrations'))) {
          if (!applied.has(`${desk.name}/${f}`)) bad(`${desk.name}: migration ${f} not applied: run init`);
        }
        const missing = desk.needs.filter((n) => !hasSetting(n));
        if (missing.length) bad(`${desk.name} needs ${missing.join(', ')}: see "Needs" in desks/${desk.name}/desk.md`);
        else ok(`${desk.name}: ready${desk.needs.length ? ` (${desk.needs.join(', ')} set)` : ''}`);
      }
    }
    db.close();
  }

  const desks = desksOnDisk();
  for (const [a, names] of mailClashes(desks)) bad(`${a} is in the Mail: line of ${names.join(' and ')}: an address belongs to one desk, so take it out of the others`);
  const listening = desks.filter((d) => d.mail.length);
  if (listening.length) {
    const missing = ['DESK_MAIL_URL', 'DESK_MAIL_TOKEN'].filter((n) => !setting(n));
    if (missing.length) bad(`${listening.map((d) => d.name).join(', ')} answer${listening.length === 1 ? 's' : ''} mail, so set ${missing.join(' and ')} in desks/.env (kit/mail/README.md)`);
    else {
      try {
        const t0 = Date.now();
        await mailGet('/v1/changes', [...new Set(listening.flatMap((d) => d.mail))].map((a) => ['mailbox', a]).concat([['after', 'latest']]));
        ok(`mail Worker at ${new URL(MAIL_URL).host} answers in ${Date.now() - t0} ms`);
      } catch (e) {
        bad(e.message);
      }
    }
  }

  if (!HOSTED) {
    const file = localPath(DB);
    if (fs.existsSync(file)) {
      const mode = fs.statSync(file).mode & 0o777;
      if (mode & 0o077) bad(`${file} can be read by other users: chmod 600 it`);
    }
  }
  try {
    const checks = [
      [MAIN, 'desks/data/x'],
      [MAIN, 'desks/.env'],
      [MAIN, 'desks/mail/.dev.vars'],
      ...(MAIN === ROOT ? [] : [[ROOT, 'desks/data']]),
    ];
    for (const [dir, p] of checks) {
      try { execFileSync('git', ['-C', dir, 'check-ignore', '-q', p], { stdio: 'ignore' }); } catch (e) {
        if (e.status !== 1) throw e;
        const what = p.replace(/\/x$/, '/');
        bad(dir === ROOT
          ? `${what} is not ignored by git: run init, which adds it to desks/.gitignore`
          : `${what} in the main checkout is not ignored by git until the desks are merged there: add ${what.replace(/\/$/, '')} to ${path.join(MAIN, '.git/info/exclude')} meanwhile`);
      }
    }
  } catch {
    note('not a git repository, so nothing to keep out of git');
  }
  console.log(problems.length ? `\n${problems.length} thing${problems.length === 1 ? '' : 's'} to fix.` : '\nAll good.');
  return problems.length ? 1 : 0;
}

// A JWT (from the token command) goes as Bearer. Anything else is the plain secret of a
// server started with SQLD_HTTP_AUTH=basic:<secret>, as the Railway template does.
export function authHeader(token) {
  return token.split('.').length === 3 ? `Bearer ${token}` : `Basic ${token}`;
}

function token(flags) {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const key = publicKey.export({ format: 'jwk' }).x;
  const part = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const head = part({ alg: 'EdDSA', typ: 'JWT' });
  const body = part({ a: 'rw', iat: Math.floor(Date.now() / 1000) });
  const sig = crypto.sign(null, Buffer.from(`${head}.${body}`), privateKey).toString('base64url');
  const jwt = `${head}.${body}.${sig}`;
  if (flags.json) console.log(JSON.stringify({ SQLD_AUTH_JWT_KEY: key, DESK_DB_TOKEN: jwt }));
  else {
    console.log('Set this on the hosted database (the server checks tokens with it):');
    console.log(`SQLD_AUTH_JWT_KEY=${key}\n`);
    console.log('Put this in desks/.env on every machine that uses the desk (keep it out of git and chat):');
    console.log(`DESK_DB_TOKEN=${jwt}`);
  }
  return 0;
}

async function readStdin() {
  const chunks = [];
  for await (const c of process.stdin) chunks.push(c);
  return Buffer.concat(chunks).toString('utf8');
}

function help() {
  const lines = fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(1);
  const end = lines.findIndex((l) => !l.startsWith('//'));
  return lines.slice(0, end).map((l) => l.replace(/^\/\/ ?/, '')).join('\n');
}

// In a worktree, desks/data is a link to the main checkout's, so private files written
// here outlive the worktree. A worktree's own data folder is left alone; doctor flags it.
function linkWorktreeData() {
  const link = path.join(DESKS, 'data');
  if (MAIN === ROOT || fs.existsSync(link)) return;
  try { fs.unlinkSync(link); } catch {}
  const target = path.join(MAIN, 'desks', 'data');
  fs.mkdirSync(target, { recursive: true, mode: 0o700 });
  fs.symlinkSync(target, link, 'junction');
}

async function main() {
  const { flags, rest } = parseArgs(process.argv.slice(2));
  const [cmd, ...args] = rest;
  linkWorktreeData();
  switch (cmd) {
    case 'init': return init(flags);
    case 'status': return status(flags, args[0]);
    case 'sql': {
      const text = !args.length || args[0] === '-' ? await readStdin() : args.join(' ');
      if (!text.trim()) fail('no SQL given');
      const db = await open();
      const out = await execute(db, text, { ...autoParams({ desk: deskOf(flags) ?? undefined }), ...flags.values });
      db.close();
      print(out, flags);
      const last = out.results.at(-1);
      if (flags.expectRows && !(last?.cols.length ? last.rows.length : last?.changes)) {
        fail('the last statement matched no rows (--expect-rows), so stop here');
      }
      return 0;
    }
    case 'lock': return lock(flags, args[0], args.slice(1).join(' '));
    case 'unlock': return unlock(flags, args[0]);
    case 'take': return take(flags, args[0], args.slice(1).join(' '));
    case 'export': return exportTable(flags, args[0], args[1]);
    case 'dump': return dump(flags, args[0]);
    case 'restore': return restore(flags, args[0]);
    case 'doctor': return doctor();
    case 'token': return token(flags);
    case 'watch': return watch(flags, args[0]);
    case 'mail': return mail(flags, args);
    case 'send': return send(flags, args[0]);
    case undefined: case 'help': case '--help': case '-h':
      console.log(help());
      return 0;
    default:
      fail(`unknown command "${cmd}": run node desks/desk.mjs help`);
  }
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then((code) => { process.exitCode = code ?? 0; }).catch((e) => {
    console.error(`error: ${e instanceof DeskError ? e.message : (e.stack || e.message)}`);
    process.exitCode = 1;
  });
}
