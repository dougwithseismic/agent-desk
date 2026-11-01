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
//   node desks/desk.mjs watch <desk>              wait until the desk has something to do (mail, a
//                                                 handover, a due task or check, its Round: time), print a
//                                                 line for each and exit (--every 30s; --max ends a quiet wait)
//   node desks/desk.mjs mail inbox|search <text>|sent   mail in the mail Worker (--desk, --mailbox, --limit,
//                                                 --key for sent)
//   node desks/desk.mjs mail read|thread <id>     one email in full, or its whole conversation
//   node desks/desk.mjs mail status|suppressions  the Worker's addresses, sends and caps; who never gets mail
//   node desks/desk.mjs mail suppress <address> "<reason>"
//   node desks/desk.mjs send <action id>          send an approved email action exactly as stored, and record it
//   node desks/desk.mjs stripe <path> [name=value ...]  read Stripe: one GET, printed as JSON (--all follows pages)
//   node desks/desk.mjs stripe revenue|mrr|customers|failed  what the business earns (--days, --currency;
//                                                 --record <name> --desk <desk> saves it in measures)
//
// In SQL, :me is you (DESK_USER), :now the time, :today the date and :desk the --desk value.
// An agent works under its own name with --as <name> (or DESK_AS in the environment), for a
// desk whose desk.md says Agent: <name>. Then :me is the agent and :person the person it
// works for (DESK_USER), whose say-so it records only in their own words.
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
//   DESK_AS        the agent you work as, like --as (read from the environment only)
//   DESK_MAIL_URL  the mail Worker that desks with a Mail: line listen to (kit/mail/README.md)
//   DESK_MAIL_TOKEN  that Worker's MAIL_API_TOKEN
//   DESK_MAIL_PREFIX  the word inbox ids for mail start with: mail (the default), or the one
//                     a project's own Worker already uses (acme-mail:<mailbox>:<id>)
//   DESK_STRIPE_KEY  a restricted Stripe key with read access (rk_live_ or rk_test_), or a test
//                    secret key (sk_test_); a live secret key is refused (kit/playbooks/revenue.md)

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
const PERSON = setting('DESK_USER');
let USER = PERSON; // who is working: the person, or the agent named by --as or DESK_AS
let AGENT = null;
const isPerson = (name) => Boolean(PERSON) && name === PERSON.toLowerCase();
const isWord = (x) => /^[a-z][a-z0-9-]*$/.test(x);
const HOSTED = /^(https?|libsql):\/\//.test(DB);
const MAIL_URL = setting('DESK_MAIL_URL')?.replace(/\/+$/, '');
const STRIPE_KEY = setting('DESK_STRIPE_KEY');
const STRIPE_URL = setting('DESK_STRIPE_URL', 'https://api.stripe.com').replace(/\/+$/, '');
const STRIPE_MODE = /^(rk|sk)_test_/.test(STRIPE_KEY ?? '') ? 'test' : 'live';
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
  return { me: USER, person: PERSON, now, today: now.slice(0, 10), ...extra };
}

function bindStatements(text, values) {
  const stmts = splitSql(text);
  return stmts.map((s) => {
    const args = {};
    for (const p of s.params) {
      const name = p.slice(1);
      if (!(name in values) || values[name] === undefined) {
        if (name === 'me' || name === 'person') fail(`the SQL uses :${name} but DESK_USER is not set. Put DESK_USER=<your name> in desks/.env`);
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
            // node:sqlite binds every number as REAL, so :n = 7 reaches SQL as 7.0 and reads
            // '7.0' as text. Whole numbers go in as integers, as they do on a hosted database.
            const args = Object.fromEntries(Object.entries(s.args).map(([k, v]) => [k, Number.isSafeInteger(v) ? BigInt(v) : v]));
            if (cols.length) {
              st.setReturnArrays(true);
              const rows = st.all(args).map((r) => r.map((v) => (v instanceof Uint8Array ? Buffer.from(v) : v)));
              results.push({ cols, rows, changes: rows.length });
            } else {
              const r = st.run(args);
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
    else if (a === '--as') flags.as = argv[++i] ?? fail('--as needs the name of an agent, from an Agent: line');
    else if (a === '--every' || a === '--max') flags[a.slice(2)] = argv[++i] ?? fail(`${a} needs a time, such as 30s or 25m`);
    else if (['--limit', '--key', '--days', '--currency', '--record'].includes(a)) flags[a.slice(2)] = argv[++i] ?? fail(`${a} needs a value`);
    else if (a === '--all') flags.all = true;
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
// can say Headline:, Target:, Needs: (env var names, comma separated), Mail: (the
// addresses the desk answers, comma separated), Round: (when its rounds are due, such as
// weekdays 09:00), Agent: (the name its agent works under) and Type: (the kind of desk it
// started as, from kit/types/: a gm desk only briefs).
function desksOnDisk() {
  return fs.readdirSync(DESKS, { withFileTypes: true })
    .filter((d) => d.isDirectory() && fs.existsSync(path.join(DESKS, d.name, 'desk.md')))
    .map((d) => {
      const dir = path.join(DESKS, d.name);
      const md = fs.readFileSync(path.join(dir, 'desk.md'), 'utf8');
      const head = md.split(/^## /m)[0];
      const field = (k) => head.match(new RegExp(`^${k}:[ \\t]*(.+)$`, 'mi'))?.[1].trim();
      return {
        name: d.name,
        dir,
        title: md.match(/^#\s+(.+)$/m)?.[1].trim() || d.name,
        headline: field('Headline'),
        target: field('Target'),
        needs: (field('Needs') || '').split(/[,\s]+/).filter((x) => /^[A-Z][A-Z0-9_]*$/.test(x)),
        mail: [...new Set((field('Mail') || '').toLowerCase().split(/[,\s]+/).filter((x) => /^[^@<>]+@[^@<>]+\.[^@<>]+$/.test(x)))],
        round: field('Round'),
        agent: field('Agent')?.toLowerCase(),
        type: field('Type')?.toLowerCase(),
      };
    })
    .map((d) => ({ ...d, fault: d.agent && !isWord(d.agent) ? `desks/${d.name}/desk.md: Agent: ${d.agent} is not a name: use letters, digits and dashes, such as gm`
      : d.agent && isPerson(d.agent) ? `desks/${d.name}/desk.md: Agent: ${d.agent} is you (DESK_USER): the database can't tell your say-so from its work, so give the agent a name of its own`
        : d.type && !isWord(d.type) ? `desks/${d.name}/desk.md: Type: ${d.type} is not a type: use one word, such as gm`
          : null }));
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
  const disk = desksOnDisk();
  for (const d of disk) if (d.fault) fail(d.fault);
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
  for (const desk of disk) {
    await execute(db, `INSERT INTO desks(name, title, headline, target, type) VALUES (:name, :title, :headline, :target, :type)
      ON CONFLICT(name) DO UPDATE SET title = excluded.title, headline = excluded.headline, target = excluded.target, type = excluded.type;
      ${desk.agent ? 'INSERT INTO agents(name, desk, for_whom) VALUES (:agent, :name, :whom) ON CONFLICT DO NOTHING;' : ''}`,
    { name: desk.name, title: desk.title, headline: desk.headline ?? null, target: desk.target ?? null, type: desk.type ?? null,
      ...(desk.agent && { agent: desk.agent, whom: PERSON || 'setup' }) });
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
  if (!PERSON) console.log('Set DESK_USER=<your name> in desks/.env so your work is recorded as yours.');
  db.close();
}

// --as gm, or DESK_AS=gm: the agent works under its own name, which must be an agent's in
// this database, so the guards that tell agents from people apply to it.
async function workAs(flags, cmd) {
  const name = (flags.as ?? process.env.DESK_AS)?.toLowerCase();
  if (!name) return;
  if (isPerson(name)) fail(`--as ${name} is you (DESK_USER): --as names an agent, from a desk's Agent: line`);
  if (!['init', 'doctor', 'help', '--help', '-h', undefined].includes(cmd)) {
    const db = await open();
    let rows = [];
    try { rows = (await execute(db, 'SELECT desk FROM agents WHERE name = :name', { name })).results[0].rows; } catch {}
    db.close();
    if (!rows.length) fail(`${name} isn't an agent in this database: put "Agent: ${name}" in its desk's desk.md and run node desks/desk.mjs init`);
  }
  AGENT = name;
  USER = name;
}

// Whether a desk's listener is looking: someone holds listen:<desk> and it looked lately. A
// chat that was woken stops looking while it works, so a gap can be work, not a closed app.
function listeningNow({ by, looked }) {
  const gap = looked ? Math.max(0, Date.now() - Date.parse(looked)) : null;
  if (!by) return looked ? `last listened ${ago(gap)} ago` : 'not listening';
  if (gap !== null && gap < 15 * 60000) return `listening (${by}, looked ${ago(gap)} ago)`;
  return `${by} holds listening, last looked ${looked ? `${ago(gap)} ago` : 'never'}`;
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
    SELECT desk, by, since, looked_at FROM listening WHERE ${f()};
    SELECT to_desk AS desk, count(*) AS open, max(days) AS oldest_days FROM briefs
      WHERE task_status = 'open' AND (:d IS NULL OR to_desk = :d) GROUP BY to_desk;
    SELECT name, desk, for_whom FROM agents WHERE ${f()} ORDER BY desk, name;
    SELECT desk, count(*) AS due, sum(trouble > 0) AS trouble FROM audit_due WHERE ${f()} GROUP BY desk;
    SELECT id, desk, checked, verdict, notes, by FROM audit_findings WHERE ${f()} ORDER BY id DESC;
  `, v);
  if (flags.json) {
    const names = ['board', 'waiting', 'due', 'in_flight', 'locks', 'holds', 'trust', 'lessons', 'listening', 'briefs', 'agents', 'audits_due', 'audit_findings'];
    console.log(JSON.stringify(Object.fromEntries(results.map((r, i) => [names[i], asObjects(r.cols, r.rows)])), null, 2));
    db.close();
    return;
  }
  const [board, waiting, due, flight, locks, holds, trust, lessons, listening, briefs, agents, auditsDue, findings] = results;
  const heard = new Map(listening.rows.map(([d, by, , looked]) => [d, { by, looked }]));
  const briefed = new Map(briefs.rows.map(([d, n, days]) => [d, { n, days }]));
  const unaudited = new Map(auditsDue.rows.map(([d, n, trouble]) => [d, { n, trouble }]));
  const you = AGENT ? `${AGENT}, an agent working for ${PERSON ?? '(DESK_USER not set)'}` : USER ?? '(DESK_USER not set)';
  console.log(`${HOSTED ? 'Hosted' : 'Local'} database ${db.where}, you are ${you}.`);
  if (!board.rows.length) console.log(desk ? `No desk called ${desk}: run init after adding desks/${desk}/desk.md.` : 'No desks yet.');
  for (const r of board.rows) {
    const [name, w, d, fl, u, l, headline, value, previous, target] = r;
    const bits = [`${w} waiting`, `${d} due`, `${fl} in flight`];
    if (u) bits.push(`${u} UNCERTAIN`);
    if (l) bits.push(`${l} locked`);
    const br = briefed.get(name);
    if (br) bits.push(`${br.n} brief${br.n === 1 ? '' : 's'} open, oldest ${ago(br.days * 86400000)}`);
    const au = unaudited.get(name);
    if (au) bits.push(`${au.n} sent alone, not audited${au.trouble ? ` (${au.trouble} with trouble since)` : ''}`);
    const ear = heard.get(name);
    if (ear) bits.push(listeningNow(ear));
    let line = `${name}: ${bits.join(' · ')}`;
    if (headline) line += ` · ${headline} ${value ?? 'not measured yet'}${previous !== null && previous !== undefined ? ` (was ${previous})` : ''}`;
    if (target) line += ` · target ${target}`;
    console.log(line);
  }
  if (agents.rows.length) console.log(`Agents: ${agents.rows.map(([n, d, w]) => `${n} works ${d} for ${w}`).join('; ')}.`);
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
  section('Audit findings (failed or unsure, until a later audit passes)', findings, 10, `SELECT * FROM audit_findings${where}`);
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

// ---------- the desk's listener ----------

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const retryable = (msg) => Object.assign(new DeskError(msg), { retry: true });
const ago = (ms) => (ms >= 172800000 ? `${Math.round(ms / 86400000)} days`
  : ms >= 7200000 ? `${Math.round(ms / 3600000)} h`
    : ms >= 60000 ? `${Math.round(ms / 60000)} min` : `${Math.round(ms / 1000)}s`);

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
  if (!isWord(MAIL_PREFIX)) fail(`DESK_MAIL_PREFIX is the one word inbox ids for mail start with, such as mail or acme-mail, not "${line1(MAIL_PREFIX)}"`);
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

// A desk's Round: line, such as "weekdays 09:00" or "mon thu 08:30, 14:00": the days of the
// week it runs on (0 is Sunday) and its times in minutes after midnight, in this machine's
// local time. No days means every day. Throws a DeskError saying what it can't read.
const DAY_NAMES = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const ROUND_EXAMPLE = '"Round: weekdays 09:00" or "Round: mon thu 08:30, 14:00"';

export function parseRound(text) {
  const days = new Set();
  const times = new Set();
  const words = String(text).toLowerCase().replace(/\bevery\s+day\b/g, 'daily').split(/[\s,]+/)
    .map((w) => w.replace(/\.$/, '')).filter(Boolean);
  for (const w of words) {
    const t = w.match(/^(\d{1,2})[:.](\d{2})$/);
    const stem = w.replace(/s$/, '');
    if (t) {
      if (Number(t[1]) > 23 || Number(t[2]) > 59) fail(`${w} isn't a time of day`);
      times.add(Number(t[1]) * 60 + Number(t[2]));
    } else if (w === 'daily' || w === 'everyday') [0, 1, 2, 3, 4, 5, 6].forEach((d) => days.add(d));
    else if (stem === 'weekday') [1, 2, 3, 4, 5].forEach((d) => days.add(d));
    else if (stem === 'weekend') [0, 6].forEach((d) => days.add(d));
    else if (!['at', 'and', 'on', 'every'].includes(w)) {
      const day = stem.length >= 3 ? DAY_NAMES.findIndex((n) => n.startsWith(stem)) : -1;
      if (day < 0) fail(`"${w}" isn't a day or a time`);
      days.add(day);
    }
  }
  if (!times.size) fail('it has no time');
  if (!days.size) [0, 1, 2, 3, 4, 5, 6].forEach((d) => days.add(d));
  return { days, times: [...times].sort((a, b) => a - b) };
}

// The desk's schedule, read from its Round: line: null when it has none.
function roundOf(desk) {
  if (!desk.round) return null;
  try {
    return { text: line1(desk.round), ...parseRound(desk.round) };
  } catch (e) {
    if (!(e instanceof DeskError)) throw e;
    return fail(`desks/${desk.name}/desk.md has "Round: ${line1(desk.round)}", and ${e.message}: write it like ${ROUND_EXAMPLE}`);
  }
}

// The scheduled rounds after `after` (a Date; null for none) up to `now`: the latest, and
// how many there were (looking back a year at most). With no `after`, the latest only.
export function roundsDue(round, after, now) {
  let latest = null;
  let count = 0;
  for (let back = 0; back <= 366 && !(latest && !after); back++) {
    const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() - back);
    if (after && new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1) <= after) break;
    if (!round.days.has(day.getDay())) continue;
    for (const t of round.times.toReversed()) {
      const at = new Date(day.getFullYear(), day.getMonth(), day.getDate(), Math.floor(t / 60), t % 60);
      if (at > now || (after && at <= after)) continue;
      latest ??= at;
      count++;
    }
  }
  return { latest, count };
}

// A time as this machine's local date and time: 2026-10-30 09:00.
const localStamp = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

// Waits, with no model calls, until the desk has something to do: mail to its own
// addresses, mail another desk handed over, a task or check of the agent's that comes due,
// or a round on its schedule. Prints a line for each on stdout and exits 0, which wakes the
// chat that started it. With --max, a quiet spell that long ends it too, saying so. Everything
// else goes to stderr. One person listens to a desk: the lock listen:<desk>.
async function watch(flags, deskName) {
  const name = deskName ?? deskOf(flags);
  if (!name) fail('usage: desk.mjs watch <desk>');
  const desks = desksOnDisk();
  const desk = desks.find((d) => d.name === name);
  if (!desk) fail(`no desk called ${name}: a desk is a folder in desks/ with a desk.md`);
  const round = roundOf(desk);
  const hasMail = desk.mail.length > 0;
  if (hasMail) {
    const clashes = mailClashes(desks).filter(([a]) => desk.mail.includes(a));
    if (clashes.length) {
      fail(`${clashes.map(([a, names]) => `${a} is in the Mail: line of ${names.join(' and ')}`).join('; ')}: an address belongs to one desk, so take it out of the others`);
    }
    mailSettings();
  }
  if (!USER) fail('set DESK_USER in desks/.env first, so the lock says who is listening');
  const every = duration(flags.every, 30000, '--every');
  const max = flags.max === undefined ? Infinity : duration(flags.max, 0, '--max');
  const own = new Set(desk.mail);
  const mailboxes = desk.mail.map((a) => ['mailbox', a]);
  const key = `listen:${desk.name}`;
  const { host, pathname } = hasMail ? new URL(MAIL_URL) : {};
  const source = hasMail ? `${host}${pathname.replace(/\/$/, '')} ${[...own].sort().join(',')}` : null;

  const q = (text, values) => query(text, { desk: desk.name, key, source, round: round?.text ?? null, ...values });
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

  const [ready] = await q(`SELECT (SELECT count(*) FROM sqlite_schema WHERE name IN ('mail_cursors', 'listeners')),
    (SELECT count(*) FROM desks WHERE name = :desk)`);
  if (ready.rows[0][0] < 2) fail('the database is older than the kit: run node desks/desk.mjs init');
  if (!ready.rows[0][1]) fail(`${desk.name} is not in the database yet: run node desks/desk.mjs init`);
  // This run of watch is the one listening: a newer run for the desk takes over from it.
  const run = crypto.randomUUID();
  const mine = 'EXISTS (SELECT 1 FROM locks WHERE key = :key AND by = :me)';
  const [, , held, saved, state] = await q(`
    INSERT INTO locks(key, by, desk, doing) VALUES (:key, :me, :desk, 'listening')
      ON CONFLICT(key) DO UPDATE SET doing = excluded.doing, desk = excluded.desk,
        at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE locks.by = excluded.by;
    UPDATE listeners SET run = :run WHERE desk = :desk AND ${mine};
    SELECT by, at FROM locks WHERE key = :key;
    SELECT cursor, source, handed_over FROM mail_cursors WHERE desk = :desk;
    SELECT woken_for, round, round_at, checked_at, own FROM listeners WHERE desk = :desk;`, { run });
  const [holder, since] = held.rows[0];
  if (holder !== USER) {
    const checked = state.rows[0]?.[3];
    console.error(`${holder} is listening to ${desk.name} (since ${since}${checked ? `, last looked ${checked}` : ''}). Leave it, or take it over with: node desks/desk.mjs take ${key} "listening"`);
    return 2;
  }

  // Handovers: open email inbox rows for this desk that came to an address it doesn't own
  // (none for a desk without a Mail: line). Due: the agent's open tasks and checks that are
  // due, with the date they're due for, so one moved and due again counts again.
  // listeners.woken_for keeps those already announced while they stay open and due.
  const handovers = `SELECT id, mailbox, from_addr, received_at FROM inbox WHERE desk = :desk AND channel = 'email'
    AND handled_at IS NULL AND :mail = 1 AND lower(mailbox) NOT IN (SELECT value FROM json_each(:own))`;
  const dueRefs = `SELECT type || ':' || id || '@' || coalesce(due, '') AS ref FROM due WHERE desk = :desk AND owner = 'agent'`;
  const wokenNow = `SELECT json_group_array(ref) FROM (SELECT 'inbox:' || id AS ref FROM (${handovers}) UNION ALL ${dueRefs})`;
  const ownJson = JSON.stringify([...own].sort());
  const known = { own: ownJson, mail: hasMail ? 1 : 0, run };
  const [after0, was, handedOver] = saved.rows[0] ?? [];
  let after = after0;
  let first = !state.rows[0];
  if (hasMail && was !== source) {
    console.error(was ? `${desk.name}'s addresses or mail Worker changed: listening for mail from now.`
      : first ? `First time listening for ${desk.name}: from now on.` : `Listening for ${desk.name}'s mail from now on.`);
    first = false;
    const page = await attempt(() => mailGet('/v1/changes', [...mailboxes, ['after', 'latest']]));
    if (page?.cursor == null) fail(`the mail Worker at ${host} gave no cursor for after=latest: is it the desk mail Worker? (kit/mail/README.md)`);
    const [, row] = await attempt(() => q(`
      INSERT INTO mail_cursors(desk, source, cursor, by) VALUES (:desk, :source, :cursor, :me)
        ON CONFLICT(desk) DO UPDATE SET source = excluded.source, cursor = excluded.cursor,
          checked_at = excluded.checked_at, by = excluded.by;
      SELECT cursor FROM mail_cursors WHERE desk = :desk;`, { cursor: String(page.cursor) }));
    [after] = row.rows[0];
  }

  // The first time, what's already due is the round's job, and so are rounds already past. A
  // desk that listened for mail with an older kit keeps the handovers it announced then. A
  // changed Mail: line makes handovers count from now, and a changed Round: line rounds.
  const [, roundWas, , , ownWas] = state.rows[0] ?? [];
  const roundText = round?.text ?? null;
  const from = round ? roundsDue(round, null, new Date()).latest.toISOString() : null;
  const steps = [];
  if (!state.rows[0]) {
    if (first) console.error(`First time listening for ${desk.name}: from now on.`);
    steps.push(`INSERT INTO listeners(desk, woken_for, own, round, round_at, run, by) VALUES (:desk, (
        SELECT json_group_array(ref) FROM (SELECT 'inbox:' || id AS ref FROM (${handovers})
          WHERE :handed IS NULL OR id IN (SELECT value FROM json_each(:handed)) UNION ALL ${dueRefs})),
        :own, :round, :from, :run, :me)
      ON CONFLICT(desk) DO UPDATE SET run = excluded.run, by = excluded.by`);
  } else {
    if (ownWas !== ownJson) {
      if (was === source) console.error(`${desk.name}'s Mail: line changed: handovers from now on.`);
      steps.push(`UPDATE listeners SET own = :own, woken_for = (SELECT json_group_array(ref) FROM (
          SELECT 'inbox:' || id AS ref FROM (${handovers})
          UNION ALL SELECT value FROM json_each(listeners.woken_for) WHERE value NOT LIKE 'inbox:%'))
        WHERE desk = :desk AND run = :run`);
    }
    if (roundWas !== roundText) {
      if (round) console.error(`${desk.name}'s Round: line changed: rounds from now on.`);
      steps.push('UPDATE listeners SET round = :round, round_at = :from WHERE desk = :desk AND run = :run');
    }
  }
  steps.push('SELECT woken_for, round_at FROM listeners WHERE desk = :desk');
  const begun = await attempt(() => q(steps.join(';\n'), {
    ...known, from, handed: was === source && handedOver ? handedOver : null,
  }));
  let [woken, roundAt] = begun.at(-1).rows[0];

  // One look: new mail from the Worker (a full page may mean more), then the database, in one
  // transaction that saves the cursor and what was announced before anything is printed, and
  // only while this run still holds the desk. What it prints is what it saved.
  const look = async () => {
    let next = after;
    const mail = [];
    for (let pages = 0; hasMail && pages < 100; pages++) {
      const page = await mailGet('/v1/changes', [...mailboxes, ['after', next], ['limit', '50']]);
      if (page?.cursor == null || !Array.isArray(page.messages)) throw retryable(`the mail Worker at ${host} answered without a cursor and messages`);
      mail.push(...page.messages.filter((m) => own.has(String(m?.mailbox).toLowerCase())));
      const moved = String(page.cursor) !== next;
      next = String(page.cursor);
      if (page.messages.length < 50 || !moved) break;
    }
    const rounds = round ? roundsDue(round, roundAt && new Date(roundAt), new Date()) : { latest: null };
    const res = await q(`
      SELECT by FROM locks WHERE key = :key;
      SELECT run FROM listeners WHERE desk = :desk;
      UPDATE listeners SET woken_for = (${wokenNow}), round_at = :round_at, checked_at = :now, by = :me
        WHERE desk = :desk AND run = :run AND ${mine};
      ${hasMail ? `UPDATE mail_cursors SET cursor = :next, checked_at = :now, by = :me WHERE desk = :desk
        AND EXISTS (SELECT 1 FROM listeners WHERE desk = :desk AND run = :run) AND ${mine};` : ''}
      SELECT woken_for FROM listeners WHERE desk = :desk;
      SELECT id, mailbox, from_addr FROM inbox WHERE desk = :desk
        AND 'inbox:' || id IN (SELECT value FROM json_each((SELECT woken_for FROM listeners WHERE desk = :desk)))
        ORDER BY received_at, id;`,
    { ...known, next, round_at: rounds.latest?.toISOString() ?? roundAt });
    const by = res[0].rows[0]?.[0];
    if (by !== USER) return { stop: by ? `${by} took over listening to ${desk.name}: stopped.` : `nobody holds ${key} any more (it was unlocked): stopped listening.` };
    if (res[1].rows[0]?.[0] !== run) return { stop: `a newer watch for ${desk.name} took over: this one stopped.` };
    const seen = new Set(JSON.parse(woken));
    [woken] = res.at(-2).rows[0];
    after = next;
    roundAt = rounds.latest?.toISOString() ?? roundAt;
    const due = JSON.parse(woken).filter((r) => !seen.has(r)).map((r) => r.match(/^(task|check):(\d+)@(.*)$/s)).filter(Boolean)
      .map(([, type, id, when]) => ({ type, id: Number(id), due: when }))
      .sort((a, b) => a.due.localeCompare(b.due) || b.type.localeCompare(a.type) || a.id - b.id);
    return { mail, handed: res.at(-1).rows.filter(([id]) => !seen.has(`inbox:${id}`)), due, rounds };
  };

  const line = flags.json ? (o) => JSON.stringify(o) : (o) => {
    if (o.event === 'round') return `round due ${o.at} (${o.round})${o.missed ? `, missed ${o.missed}` : ''}`;
    if (o.event === 'task' || o.event === 'check') return `${o.event} ${o.id} due ${o.due}`;
    return `${o.event} ${o.id} from ${o.from} to ${o.mailbox}${o.auto ? ', automatic' : ''}`;
  };
  const hears = [
    hasMail ? `mail to ${[...own].join(', ')}` : null,
    'tasks and checks that come due',
    round ? `rounds (${round.text})` : null,
  ].filter(Boolean);
  console.error(`Listening for ${desk.name}: ${hears.join(', ')}. Looking every ${ago(every)}${max < Infinity ? `, for up to ${ago(max)}` : ''}.${hasMail ? '' : ' No Mail: line, so no mail.'}`);
  const deadline = Date.now() + max;
  for (;;) {
    const { stop, mail, handed, due: dueNew, rounds } = await attempt(look);
    if (stop) {
      console.error(stop);
      return 2;
    }
    const events = [
      ...mail.map((m) => ({ event: 'mail', desk: desk.name, id: inboxId(m), mailbox: oneWord(m.mailbox).toLowerCase(),
        from: address(m.from) || 'unknown', auto: m.auto === true || m.auto === 1 })),
      ...handed.map(([id, mailbox, from]) => ({ event: 'handover', desk: desk.name, id: oneWord(id), mailbox: oneWord(mailbox), from: address(from) || 'unknown' })),
      ...dueNew.map((d) => ({ event: d.type, desk: desk.name, id: d.id, due: d.due === '' ? 'now' : oneWord(d.due) })),
      ...(rounds.latest ? [{ event: 'round', desk: desk.name, at: localStamp(rounds.latest), round: round.text, ...(rounds.count > 1 ? { missed: rounds.count } : {}) }] : []),
    ];
    if (events.length) {
      for (const e of events) console.log(line(e));
      return 0;
    }
    if (Date.now() + every > deadline) {
      console.log(flags.json ? JSON.stringify({ event: 'quiet', desk: desk.name, waited: ago(max) }) : `nothing new for ${desk.name} in ${ago(max)}`);
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
  if (a.channel !== 'email' && a.channel !== 'desk') stop(`goes out by ${a.channel}, not email: send it with the desk's own tool`);
  const already = `was ${a.channel === 'desk' ? 'delivered' : 'sent'} already (${a.provider_ref})`;
  const mode = { approved: 'human', draft: 'auto' }[a.status];
  if (!mode) {
    stop({
      waiting: 'is waiting for a person: show it and ask',
      sending: `is being sent by ${a.sent_by}. If that stopped mid-way, ${look} and settle it (together.md)`,
      sent: already,
      verified: already,
      uncertain: `might have gone already, so it is never sent again: ${look}, then settle it as sent or failed`,
      failed: 'failed, and that is final: a new try is a new action with a new key',
    }[a.status] ?? `is ${a.status}`);
  }
  if (a.channel === 'desk') return sendBrief(flags, id, a, mode, stop);
  mailSettings();
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

// Delivers a brief (channel desk) as a task on the desk it names. The claim, the task and the
// record are one write, so a brief is delivered once or not at all. Nothing leaves the
// database, so delivery is its own verification.
async function sendBrief(flags, id, a, mode, stop) {
  let results;
  try {
    results = await query(`
      UPDATE actions SET status = 'sending', mode = :mode, sent_by = :me, last_by = :me WHERE id = :id AND status = :was;
      INSERT INTO tasks(desk, what, owner, about, due, done_when, source, created_by)
        SELECT substr(target, 6), title, coalesce(json_extract(payload, '$.owner'), 'agent'),
          json_extract(payload, '$.about'), json_extract(payload, '$.due'),
          json_extract(payload, '$.done_when'), 'brief:' || id, :me
        FROM actions WHERE id = :id AND status = 'sending' AND sent_by = :me;
      UPDATE actions SET status = 'verified', last_by = :me,
          provider_ref = (SELECT 'task:' || t.id FROM tasks t WHERE t.source = 'brief:' || actions.id),
          result = 'delivered to the ' || substr(target, 6) || ' desk'
        WHERE id = :id AND status = 'sending' AND sent_by = :me;
      SELECT a.status, a.provider_ref, a.result, t.id AS task, t.desk FROM actions a
        LEFT JOIN tasks t ON t.source = 'brief:' || a.id WHERE a.id = :id;`, { id, mode, was: a.status });
  } catch (e) {
    if (!(e instanceof DeskError)) throw e;
    fail(`not sent: ${e.message}`);
  }
  const [status, ref, result, task, desk] = results.at(-1).rows[0] ?? [];
  if (!results[0].changes) {
    stop(status === 'verified' ? `was delivered already (${ref})` : 'changed while it was being sent: read it again');
  }
  if (flags.json) console.log(JSON.stringify({ action: id, status, provider_ref: ref, result, key: a.key, task, desk }));
  else console.log(`Delivered #${id} to the ${desk} desk as task ${task}${mode === 'auto' ? ', on its own' : ''}. A chat listening to ${desk} wakes for it, and the result comes back in the log.`);
  return 0;
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
  PERSON ? ok(`you are ${PERSON}`) : bad('DESK_USER is not set: put DESK_USER=<your name> in desks/.env');
  const disk = desksOnDisk();
  for (const d of disk) if (d.fault) bad(d.fault);
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
      for (const f of migrationFiles(path.join(KIT, 'migrations'))) {
        if (!applied.has(`core/${f}`)) bad(`core migration ${f} not applied: run node desks/desk.mjs init`);
      }
      let types = new Map();
      try { types = new Map((await execute(db, 'SELECT name, type FROM desks')).results[0].rows); } catch {}
      const known = new Set((await execute(db, 'SELECT name FROM desks')).results[0].rows.map((r) => r[0]));
      let agents = new Set();
      try { agents = new Set((await execute(db, "SELECT name || '/' || desk FROM agents")).results[0].rows.map((r) => r[0])); } catch {}
      for (const desk of disk) {
        if (!known.has(desk.name)) { bad(`${desk.name}: not in the database yet: run init`); continue; }
        if (desk.agent && !agents.has(`${desk.agent}/${desk.name}`)) bad(`${desk.name}: Agent: ${desk.agent} is not in the database yet: run init`);
        if (types.size && (types.get(desk.name) ?? null) !== (desk.type ?? null)) bad(`${desk.name}: Type: ${desk.type ?? '(none)'} is not in the database yet: run init`);
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
  for (const d of desks) {
    try { roundOf(d); } catch (e) { if (e instanceof DeskError) bad(e.message); else throw e; }
  }
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

  if (STRIPE_KEY) {
    try {
      const t0 = Date.now();
      await stripeGet('balance_transactions', [['limit', '1']]);
      ok(`Stripe reads in ${STRIPE_MODE} mode, in ${Date.now() - t0} ms`);
    } catch (e) {
      bad(e.message);
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

// ---------- Stripe: read what the business earns (kit/playbooks/revenue.md) ----------
// Reads only. Every request is a GET, and a live secret key, which could change things, is
// refused before any call. Changes in Stripe are a person's, in the Dashboard.

function stripeKeyFault() {
  if (!STRIPE_KEY) return 'DESK_STRIPE_KEY is not set: put a restricted key with read access (rk_live_ or rk_test_) in desks/.env (kit/playbooks/revenue.md)';
  if (STRIPE_KEY.startsWith('sk_live_')) return 'DESK_STRIPE_KEY is a live secret key, which can change things in Stripe: make a restricted key with read access and use that (kit/playbooks/revenue.md)';
  if (!/^(rk_live|rk_test|sk_test)_[A-Za-z0-9]+$/.test(STRIPE_KEY)) return "DESK_STRIPE_KEY isn't a key this command takes: it starts rk_live_, rk_test_ or sk_test_";
  if (STRIPE_MODE === 'live' && STRIPE_URL !== 'https://api.stripe.com') return 'a live key goes only to https://api.stripe.com: take DESK_STRIPE_URL out of desks/.env';
  return null;
}
// Stripe's messages may quote part of a key; never pass one on.
const unkeyed = (text) => String(text).replace(/\b(sk|rk|pk)_(live|test)_[A-Za-z0-9*]+/g, '<key>');

async function stripeGet(route, query = []) {
  const fault = stripeKeyFault();
  if (fault) fail(fault);
  const url = new URL(`${STRIPE_URL}/v1/${route}`);
  for (const [k, v] of query) url.searchParams.append(k, v);
  let res, text;
  try {
    res = await fetch(url, { method: 'GET', headers: { authorization: `Bearer ${STRIPE_KEY}` }, redirect: 'manual', signal: AbortSignal.timeout(30000) });
    text = await res.text();
  } catch (e) {
    fail(`could not reach Stripe at ${url.host} (${e.cause?.code || e.name})`);
  }
  let json = null;
  try { json = JSON.parse(text); } catch {}
  const why = unkeyed(said(json, text));
  if (res.status === 401) fail(`Stripe refused DESK_STRIPE_KEY (401: ${why}): it may be mistyped or revoked; make a new restricted key`);
  if (res.status === 403) fail(`the key can't read ${route} (403: ${why}): give the restricted key read access to it (kit/playbooks/revenue.md)`);
  if (res.status !== 200 || !json) fail(`Stripe answered ${res.status} for ${route}: ${why}`);
  return json;
}

// Every object in a list, 100 a page, up to 10,000. Search pages by next_page.
async function stripeAll(route, query = []) {
  const data = [];
  const base = [...query.filter(([k]) => k !== 'limit'), ['limit', '100']];
  let page = await stripeGet(route, base);
  for (;;) {
    data.push(...(page.data ?? []));
    if (data.length >= 10000) return { data: data.slice(0, 10000), more: true };
    const next = page.next_page ? ['page', page.next_page] : page.has_more && page.data?.length ? ['starting_after', page.data.at(-1).id] : null;
    if (!next) return { data, more: false };
    page = await stripeGet(route, [...base.filter(([k]) => k !== next[0]), next]);
  }
}

// Amounts come in the currency's smallest unit: cents, nothing smaller for these, and
// thousandths for the three-decimal ones.
const ZERO_DECIMAL = new Set(['bif', 'clp', 'djf', 'gnf', 'jpy', 'kmf', 'krw', 'mga', 'pyg', 'rwf', 'ugx', 'vnd', 'vuv', 'xaf', 'xof', 'xpf']);
const THREE_DECIMAL = new Set(['bhd', 'jod', 'kwd', 'omr', 'tnd']);
const major = (amount, cur) => Math.round(amount) / (ZERO_DECIMAL.has(cur) ? 1 : THREE_DECIMAL.has(cur) ? 1000 : 100);
const PER_MONTH = { day: 365 / 12, week: 52 / 12, month: 1, year: 1 / 12 };
const since = (time) => [['created[gte]', String(time)]];

// Each summary reads what it needs into rows, one per currency (row(cur) starts a blank()
// one), or a single row when it's `overall`. `money` names the fields in the currency's
// smallest unit, shown in whole units. value() is the number --record saves.
const stripeSummaries = {
  revenue: {
    what: 'charges minus refunds', window: true, money: ['revenue', 'charged', 'refunded', 'fees', 'net'],
    blank: () => ({ revenue: 0, charged: 0, refunded: 0, fees: 0, net: 0, charges: 0, refunds: 0 }),
    unit: (cur) => cur.toUpperCase(), value: (r) => r.revenue,
    async read(time, row) {
      const { more, data } = await stripeAll('balance_transactions', since(time));
      for (const t of data) {
        const charge = ['charge', 'payment'].includes(t.type);
        if (!charge && !['refund', 'payment_refund'].includes(t.type)) continue;
        const r = row(t.currency);
        if (charge) { r.charged += t.amount; r.charges++; } else { r.refunded -= t.amount; r.refunds++; }
        r.revenue += t.amount;
        r.fees += t.fee;
        r.net += t.net;
      }
      return { more };
    },
  },
  mrr: {
    what: 'active and past-due subscriptions, made monthly, before discounts (skipped: tiered or metered items)', window: false, money: ['mrr'],
    blank: () => ({ mrr: 0, subscriptions: 0, past_due: 0, skipped: 0 }),
    unit: (cur) => `${cur.toUpperCase()}/month`, value: (r) => r.mrr,
    async read(time, row) {
      const pages = await Promise.all(['active', 'past_due'].map((status) => stripeAll('subscriptions', [['status', status]])));
      for (const sub of pages.flatMap((p) => p.data)) {
        const r = row(sub.currency);
        r.subscriptions++;
        if (sub.status === 'past_due') r.past_due++;
        for (const item of sub.items?.data ?? []) {
          const { recurring, unit_amount, unit_amount_decimal } = item.price;
          const unit = unit_amount ?? (unit_amount_decimal == null ? null : Number(unit_amount_decimal));
          if (unit == null || recurring.usage_type === 'metered') { r.skipped++; continue; }
          r.mrr += unit * (item.quantity ?? 1) * PER_MONTH[recurring.interval] / recurring.interval_count;
        }
      }
      return { more: pages.some((p) => p.more) };
    },
  },
  customers: {
    what: 'new customers', window: true, overall: true,
    blank: () => ({ new: 0, paid: 0 }),
    unit: () => 'customers', value: (r) => r.new,
    async read(time, row) {
      const [customers, charges] = await Promise.all([stripeAll('customers', since(time)), stripeAll('charges', since(time))]);
      const fresh = new Set(customers.data.map((c) => c.id));
      const r = row('all');
      r.new = fresh.size;
      r.paid = new Set(charges.data.filter((ch) => ch.status === 'succeeded' && fresh.has(ch.customer)).map((ch) => ch.customer)).size;
      return { more: customers.more || charges.more };
    },
  },
  failed: {
    what: 'failed payments in the window, plus open invoices past due (a failed renewal can be in both)', window: true,
    money: ['failed_amount', 'past_due_amount'],
    blank: () => ({ failed_payments: 0, failed_amount: 0, past_due_invoices: 0, past_due_amount: 0 }),
    unit: () => 'to chase', value: (r) => r.failed_payments + r.past_due_invoices,
    async read(time, row) {
      const [charges, invoices] = await Promise.all([stripeAll('charges', since(time)), stripeAll('invoices', [['status', 'open']])]);
      for (const ch of charges.data.filter((x) => x.status === 'failed')) {
        const r = row(ch.currency);
        r.failed_payments++;
        r.failed_amount += ch.amount;
      }
      // Past due: an invoice sent to pay by a date that has gone, or one charged automatically
      // whose charge failed.
      const now = Date.now() / 1000;
      for (const i of invoices.data.filter((x) => (x.due_date ? x.due_date < now : x.attempted))) {
        const r = row(i.currency);
        r.past_due_invoices++;
        r.past_due_amount += i.amount_remaining ?? i.amount_due;
      }
      return { more: charges.more || invoices.more };
    },
  },
};

async function stripe(flags, args) {
  const [given, ...pairs] = args;
  const route = given?.replace(/^\/?(v1\/)?/, '');
  if (!route) fail('usage: desk.mjs stripe <path> [name=value ...], or stripe revenue|mrr|customers|failed');
  // stripeGet only ever sends GET; this is for a clearer answer when someone asks for a change.
  if (/^(post|put|patch|delete|create|update|cancel|refund|pay|void)$/i.test(route)) {
    fail('the stripe command only reads: a change in Stripe is a person\'s, made in the Dashboard (kit/playbooks/revenue.md)');
  }
  const bad = pairs.find((x) => !/^[^=\s]+=/.test(x));
  if (bad !== undefined) fail(`the stripe command only reads, with name=value pairs for the query: "${bad}" isn't one`);
  if (!/^[a-z][a-z0-9_]*(\/[A-Za-z0-9_]+)*$/.test(route)) fail(`"${route}" isn't a Stripe path: give it like charges, customers/cus_123 or balance_transactions`);
  if (flags.limit) fail(`stripe takes the limit as a pair: limit=${flags.limit}`);
  const summary = !pairs.length && Object.hasOwn(stripeSummaries, route) ? stripeSummaries[route] : null;
  if (!summary) {
    if (flags.record || flags.days || flags.currency) fail('--days, --currency and --record are for the summaries: stripe revenue, mrr, customers or failed, with no name=value pairs');
    const query = pairs.map((x) => { const i = x.indexOf('='); return [x.slice(0, i), x.slice(i + 1)]; });
    if (!flags.all) { console.log(JSON.stringify(await stripeGet(route, query), null, 2)); return 0; }
    const { data, more } = await stripeAll(route, query);
    console.log(JSON.stringify({ object: 'list', data, has_more: more }, null, 2));
    return 0;
  }
  if (flags.days && !summary.window) fail(`stripe ${route} is as of now, with no window: leave out --days`);
  if (flags.currency && summary.overall) fail(`stripe ${route} isn't counted per currency: leave out --currency`);
  const days = Number(flags.days ?? 28);
  if (!Number.isInteger(days) || days < 1 || days > 3650) fail('--days is a whole number of days, such as 28');
  const to = new Date();
  const from = new Date(to.getTime() - days * 86400000);
  const by = {};
  const { more } = await summary.read(Math.floor(from.getTime() / 1000), (key) => (by[key] ??= summary.blank()));
  const cur = flags.currency?.toLowerCase();
  const keys = cur ? [cur] : Object.keys(by);
  const rows = Object.fromEntries(keys.map((k) => {
    const r = by[k] ?? summary.blank();
    return [k, { ...r, ...Object.fromEntries((summary.money ?? []).map((f) => [f, major(r[f], k)])) }];
  }));
  const out = { mode: STRIPE_MODE, what: summary.what, ...(summary.window ? { days, from: from.toISOString(), to: to.toISOString() } : { at: to.toISOString() }),
    ...(summary.overall ? rows.all : { currencies: rows }), ...(more ? { capped: 'stopped at 10,000 objects: the numbers are short' } : {}) };
  if (flags.record) {
    const desk = deskOf(flags) ?? fail('--record needs --desk <name>');
    if (!desksOnDisk().some((d) => d.name === desk)) fail(`no desk called ${desk}: a desk is a folder in desks/ with a desk.md`);
    if (keys.length !== 1) {
      fail(keys.length ? `--record saves one number: add --currency (${keys.join(', ').toUpperCase()})` : 'Stripe had nothing for this: add --currency <code> to record 0');
    }
    const value = summary.value(rows[keys[0]]);
    const unit = summary.unit(keys[0]);
    await query(`INSERT INTO measures(desk, name, value, unit, period_from, period_to, source, by)
      VALUES (:desk, :name, :value, :unit, :from, :to, :source, :me)`, {
      desk, name: flags.record, value, unit,
      from: summary.window ? from.toISOString().slice(0, 10) : null, to: to.toISOString().slice(0, 10),
      source: `stripe ${route}${summary.window ? ` --days ${days}` : ''}${cur ? ` --currency ${cur}` : ''} (${STRIPE_MODE} mode)`,
    });
    out.recorded = { desk, name: flags.record, value, unit };
  }
  console.log(JSON.stringify(out, null, 2));
  return 0;
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
  await workAs(flags, cmd);
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
    case 'stripe': return stripe(flags, args);
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
