// Tests for the kit's mail Worker (template/desks/kit/mail). They run the real Worker code
// against a D1 stand-in over node:sqlite that applies the real migration, a fake
// send_email binding, and fake inbound messages made from raw RFC 5322 text.
//
//   node --test test/mail.test.mjs

import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import worker from '../template/desks/kit/mail/src/index.js';
import { freshText, replySubject } from '../template/desks/kit/mail/src/mail.js';
import { send } from '../template/desks/kit/mail/src/outbound.js';

const MAIL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../template/desks/kit/mail');
const MIGRATIONS = path.join(MAIL, 'migrations');

// The Worker logs one JSON line per event; keep the test output clean.
mock.method(console, 'log', () => {});
mock.method(console, 'error', () => {});

// A D1 database over an in-memory SQLite, with the real migrations applied. It has the
// calls D1 has (prepare/bind/first/all/run/raw, batch, exec), and refuses undefined the way
// D1 does.
function d1() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys = ON');
  for (const file of fs.readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort()) {
    sqlite.exec(fs.readFileSync(path.join(MIGRATIONS, file), 'utf8'));
  }
  const plain = (row) => (row ? { ...row } : row);
  const values = (list) => list.map((v) => {
    if (v === undefined) throw new TypeError("D1_TYPE_ERROR: Type 'undefined' not supported for value 'undefined'");
    return typeof v === 'boolean' ? Number(v) : v;
  });
  const result = (sql, params) => {
    const statement = sqlite.prepare(sql);
    if (/^\s*(SELECT|WITH|PRAGMA)\b/i.test(sql) || /\bRETURNING\b/i.test(sql)) {
      const results = statement.all(...params).map(plain);
      return { success: true, results, meta: { changes: 0, last_row_id: 0, rows_read: results.length } };
    }
    const info = statement.run(...params);
    return { success: true, results: [], meta: { changes: Number(info.changes), last_row_id: Number(info.lastInsertRowid) } };
  };
  const prepared = (sql, params = []) => ({
    sql,
    params,
    bind: (...list) => prepared(sql, values(list)),
    async first(column) {
      const row = plain(sqlite.prepare(sql).get(...params));
      if (!row) return null;
      return column === undefined ? row : (row[column] ?? null);
    },
    async all() {
      return result(sql, params);
    },
    async run() {
      return result(sql, params);
    },
    async raw({ columnNames = false } = {}) {
      const statement = sqlite.prepare(sql);
      const rows = statement.all(...params).map((r) => Object.values(r));
      return columnNames ? [statement.columns().map((c) => c.name), ...rows] : rows;
    },
  });
  const db = {
    prepare: (sql) => prepared(sql),
    async batch(statements) {
      sqlite.exec('BEGIN');
      try {
        const out = statements.map((s) => result(s.sql, s.params));
        sqlite.exec('COMMIT');
        return out;
      } catch (error) {
        sqlite.exec('ROLLBACK');
        throw error;
      }
    },
    async exec(sql) {
      sqlite.exec(sql);
      return { count: sql.split(';').filter((s) => s.trim()).length, duration: 0 };
    },
  };
  return { db, sqlite };
}

// A send_email binding that records what it's given. failWith(error) makes it throw.
function sendEmailBinding() {
  const binding = {
    sent: [],
    attempts: 0,
    failure: null,
    failWith(error) {
      binding.failure = error;
    },
    async send(message) {
      binding.attempts++;
      if (binding.failure) throw binding.failure;
      binding.sent.push(structuredClone(message));
      return { messageId: `<sent-${binding.sent.length}@mail.example.test>` };
    },
  };
  return binding;
}

const providerError = (code, message) => Object.assign(new Error(message), { code });

// An inbound email as Email Routing hands it to the Worker, from raw RFC 5322 text.
function inboundMessage(raw, { from, to }) {
  const crlf = raw.replace(/\r?\n/g, '\r\n');
  const bytes = new TextEncoder().encode(crlf);
  const headers = new Headers();
  for (const line of crlf.split('\r\n\r\n')[0].replace(/\r\n[ \t]+/g, ' ').split('\r\n')) {
    const colon = line.indexOf(':');
    if (colon > 0) headers.append(line.slice(0, colon).trim(), line.slice(colon + 1).trim());
  }
  const message = {
    from,
    to,
    headers,
    rawSize: bytes.byteLength,
    raw: new ReadableStream({
      start(controller) {
        controller.enqueue(bytes);
        controller.close();
      },
    }),
    rejected: null,
    forwards: [],
    forwardError: null,
    setReject(reason) {
      message.rejected = reason;
    },
    async forward(address) {
      if (message.forwardError) throw message.forwardError;
      message.forwards.push(address);
      return { messageId: `<fwd-${message.forwards.length}@example.test>` };
    },
  };
  return message;
}

function rfc5322({
  from = 'Jo Bloggs <jo@acme.example>',
  to = 'desk@mail.example.test',
  subject = 'Hello',
  messageId,
  inReplyTo,
  references,
  headers = {},
  text = 'Hi there.\n',
} = {}) {
  return [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${subject}`,
    'Date: Thu, 29 Oct 2026 10:00:00 +0000',
    messageId && `Message-ID: <${messageId}>`,
    inReplyTo && `In-Reply-To: <${inReplyTo}>`,
    references && `References: ${references}`,
    ...Object.entries(headers).map(([k, v]) => `${k}: ${v}`),
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: 8bit',
    '',
    text,
  ].filter(Boolean).join('\r\n');
}

const TOKEN = 'test-token-0123456789abcdef0123456789abcdef';
const DESK = 'desk@mail.example.test';
const HELLO = 'hello@example.test';

function setup(vars = {}) {
  const { db, sqlite } = d1();
  const EMAIL = sendEmailBinding();
  const env = {
    DB: db,
    EMAIL,
    MAIL_API_TOKEN: TOKEN,
    MAILBOXES: [DESK, HELLO],
    SENDERS: { [DESK]: 'Desk at Example' },
    FORWARD_TO: ['person@example.test', 'second@example.test'],
    FIRST_TOUCH_DAILY_LIMIT: 20,
    DAILY_SEND_LIMIT: 60,
    MONTHLY_SEND_LIMIT: 500,
    ...vars,
  };
  async function api(method, url, body, { token = TOKEN, authorization } = {}) {
    const headers = {};
    if (authorization !== undefined) headers.authorization = authorization;
    else if (token) headers.authorization = `Bearer ${token}`;
    if (body !== undefined) headers['content-type'] = 'application/json';
    const response = await worker.fetch(new Request(`https://mail.example.test${url}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    }), env, {});
    return { status: response.status, body: await response.json() };
  }
  async function receive(raw, { from = 'jo@acme.example', to = DESK } = {}, before) {
    const message = inboundMessage(raw, { from, to });
    before?.(message);
    await worker.email(message, env, {});
    return message;
  }
  const rows = (where = '1') => sqlite.prepare(`SELECT * FROM messages WHERE ${where} ORDER BY seq`).all().map((r) => ({ ...r }));
  const count = (table = 'messages') => sqlite.prepare(`SELECT count(*) AS n FROM ${table}`).get().n;
  const changes = (query) => api('GET', `/v1/changes?${query}`);
  return { env, EMAIL, sqlite, api, receive, rows, count, changes };
}

const email = (fields = {}) => ({
  key: 'first-touch:brand:acme',
  from: DESK,
  to: ['jo@acme.example'],
  subject: 'An idea for Acme',
  text: 'Hello Jo,\n\nShort note.\n\nDesk',
  approved: true,
  ...fields,
});

// Inbound

test('mail for a mailbox is stored once with a new seq, threaded, forwarded to each FORWARD_TO, and appears in changes', async () => {
  const t = setup();
  const raw = rfc5322({ messageId: 'jo-1@acme.example' });
  const first = await t.receive(raw);
  assert.equal(first.rejected, null);
  assert.deepEqual(first.forwards, ['person@example.test', 'second@example.test']);

  const [row] = t.rows();
  assert.equal(row.seq, 1);
  assert.equal(row.direction, 'in');
  assert.equal(row.mailbox, DESK);
  assert.equal(row.thread_id, row.id);
  assert.equal(row.message_id, 'jo-1@acme.example');
  assert.equal(row.from_addr, 'jo@acme.example');
  assert.equal(row.from_name, 'Jo Bloggs');
  assert.equal(row.subject, 'Hello');
  assert.equal(row.text, 'Hi there.\n');
  assert.equal(row.status, 'received');
  assert.equal(row.own, 0);
  assert.equal(row.auto, 0);

  // The same email delivered again is stored once and not forwarded again.
  const again = await t.receive(raw);
  assert.deepEqual(again.forwards, []);
  assert.equal(t.count(), 1);

  // The next email gets the next seq.
  await t.receive(rfc5322({ messageId: 'jo-2@acme.example', subject: 'Something else' }));
  assert.deepEqual(t.rows().map((r) => r.seq), [1, 2]);

  const feed = await t.changes(`mailbox=${DESK}&after=0`);
  assert.equal(feed.status, 200);
  assert.deepEqual(feed.body.messages[0], {
    id: row.id,
    mailbox: DESK,
    thread: row.id,
    from: 'jo@acme.example',
    received_at: row.created_at,
    auto: false,
  });
  assert.equal(feed.body.messages.length, 2);
  assert.equal(feed.body.cursor, '2');
});

test('mail for an address not in MAILBOXES is rejected and nothing is stored or forwarded', async () => {
  const t = setup();
  const message = await t.receive(rfc5322({ to: 'someone@mail.example.test' }), { to: 'someone@mail.example.test' });
  assert.equal(message.rejected, 'Address not found');
  assert.deepEqual(message.forwards, []);
  assert.equal(t.count(), 0);
});

test('the mailbox comes from the envelope recipient, with a +tag dropped and in any case', async () => {
  const t = setup();
  // Bcc'd: the desk isn't in the To header, only in the envelope.
  await t.receive(rfc5322({ to: 'someone@else.example' }), { to: 'Desk+Acme@Mail.Example.Test' });
  assert.equal(t.rows()[0].mailbox, DESK);
});

test('the email handler throws when storing fails, and forwards nothing', async () => {
  const t = setup();
  t.sqlite.exec('DROP TABLE messages');
  let message;
  await assert.rejects(
    t.receive(rfc5322({ messageId: 'jo-1@acme.example' }), {}, (m) => {
      message = m;
    }),
    /no such table: messages/,
  );
  assert.deepEqual(message.forwards, []);
  assert.equal(message.rejected, null);
});

test('a forward that fails is logged and the stored email is kept', async () => {
  const t = setup();
  const message = await t.receive(rfc5322({ messageId: 'jo-1@acme.example' }), {}, (m) => {
    m.forwardError = new Error('destination address not verified');
  });
  assert.deepEqual(message.forwards, []);
  assert.equal(t.count(), 1);
  const feed = await t.changes(`mailbox=${DESK}&after=0`);
  assert.equal(feed.body.messages.length, 1);
});

test('an alias send BCCd to the desk is stored with own = 1 and left out of changes', async () => {
  const t = setup();
  // Sent from Gmail as the desk's address to Jo, BCC'd to the desk.
  await t.receive(
    rfc5322({ from: 'Desk at Example <desk@mail.example.test>', to: 'jo@acme.example', subject: 'An idea for Acme', messageId: 'alias-1@mail.gmail.example' }),
    { from: 'person@gmail.example', to: DESK },
  );
  const [copy] = t.rows();
  assert.equal(copy.own, 1);
  assert.equal(copy.to_addrs, 'jo@acme.example');

  const feed = await t.changes(`mailbox=${DESK}&after=0`);
  assert.deepEqual(feed.body.messages, []);

  // The desk finds it by its Message-ID to check the alias send went.
  const found = await t.api('GET', `/v1/messages?q=${encodeURIComponent('<alias-1@mail.gmail.example>')}`);
  assert.deepEqual(found.body.messages.map((m) => [m.id, m.own]), [[copy.id, true]]);

  // Jo's answer threads with it and is announced.
  await t.receive(rfc5322({ subject: 'Re: An idea for Acme', inReplyTo: 'alias-1@mail.gmail.example', messageId: 'jo-2@acme.example' }));
  const reply = t.rows('own = 0')[0];
  assert.equal(reply.thread_id, copy.thread_id);
  const after = await t.changes(`mailbox=${DESK}&after=0`);
  assert.deepEqual(after.body.messages.map((m) => m.id), [reply.id]);

  // Not a first touch next time: sending to Jo (who wrote) isn't capped as one.
  assert.equal(t.rows("own = 1")[0].first_touch, 0);
});

test('inbound mail threads by In-Reply-To, then References, then our latest send to the sender with the same subject', async () => {
  const t = setup();
  const sent = await t.api('POST', '/v1/send', email({ subject: 'Partnership' }));
  assert.equal(sent.status, 200);
  const ours = t.rows()[0];

  await t.receive(rfc5322({ subject: 'Re: Partnership', inReplyTo: sent.body.message_id, messageId: 'a@acme.example' }));
  await t.receive(rfc5322({ subject: 'Different', references: `<x@nowhere.example> <${sent.body.message_id}>`, messageId: 'b@acme.example' }));
  await t.receive(rfc5322({ subject: 'RE: Partnership', messageId: 'c@acme.example' }));
  await t.receive(rfc5322({ subject: 'Unrelated', messageId: 'd@acme.example' }));
  await t.receive(rfc5322({ from: 'someone@else.example', subject: 'Re: Partnership', messageId: 'e@else.example' }), { from: 'someone@else.example' });

  const threads = Object.fromEntries(t.rows("direction = 'in'").map((r) => [r.message_id, r.thread_id]));
  assert.equal(threads['a@acme.example'], ours.thread_id);
  assert.equal(threads['b@acme.example'], ours.thread_id);
  assert.equal(threads['c@acme.example'], ours.thread_id);
  assert.notEqual(threads['d@acme.example'], ours.thread_id);
  assert.notEqual(threads['e@else.example'], ours.thread_id);
});

test('automatic mail is marked auto and its telling headers are kept', async () => {
  const t = setup();
  await t.receive(rfc5322({ subject: 'Out of office', headers: { 'Auto-Submitted': 'auto-replied' }, messageId: 'ooo@acme.example' }));
  await t.receive(rfc5322({ subject: 'News', headers: { 'List-Id': '<news.acme.example>', 'List-Unsubscribe': '<mailto:u@acme.example>' }, messageId: 'n@acme.example' }));
  await t.receive(rfc5322({ subject: 'Re: Hello', headers: { 'Auto-Submitted': 'no' }, messageId: 'p@acme.example' }));
  assert.deepEqual(t.rows().map((r) => r.auto), [1, 1, 0]);
  assert.equal(JSON.parse(t.rows()[0].headers)['auto-submitted'], 'auto-replied');
  const feed = await t.changes(`mailbox=${DESK}&after=0`);
  assert.deepEqual(feed.body.messages.map((m) => m.auto), [true, true, false]);
});

test('very long text and HTML are cut to fit a D1 row', async () => {
  const t = setup();
  await t.receive(rfc5322({ text: 'x'.repeat(250_000) }));
  assert.equal(t.rows()[0].text.length, 200_000);
});

// The changes feed

test('changes returns only inbound mail for the mailboxes asked, oldest first, after the cursor', async () => {
  const t = setup();
  await t.receive(rfc5322({ messageId: '1@acme.example', subject: 'One' }));
  await t.api('POST', '/v1/send', email({ key: 'k-out' }));
  await t.receive(rfc5322({ messageId: '2@acme.example', subject: 'Two' }), { to: HELLO });
  await t.receive(rfc5322({ messageId: '3@acme.example', subject: 'Three' }));
  await t.receive(rfc5322({ messageId: '4@acme.example', subject: 'Four' }));

  const subjectOf = Object.fromEntries(t.rows().map((r) => [r.id, r.subject]));
  const page1 = await t.changes(`mailbox=${DESK}&after=0&limit=2`);
  assert.deepEqual(page1.body.messages.map((m) => subjectOf[m.id]), ['One', 'Three']);
  const page2 = await t.changes(`mailbox=${DESK}&after=${page1.body.cursor}&limit=2`);
  assert.deepEqual(page2.body.messages.map((m) => subjectOf[m.id]), ['Four']);
  const none = await t.changes(`mailbox=${DESK}&after=${page2.body.cursor}`);
  assert.deepEqual(none.body, { cursor: page2.body.cursor, messages: [] });

  const both = await t.changes(`mailbox=${DESK}&mailbox=${encodeURIComponent('HELLO@example.test')}&after=0`);
  assert.deepEqual(both.body.messages.map((m) => subjectOf[m.id]), ['One', 'Two', 'Three', 'Four']);
  assert.deepEqual(both.body.messages.map((m) => m.mailbox), [DESK, HELLO, DESK, DESK]);
});

test('after=latest returns the current position and no messages', async () => {
  const t = setup();
  await t.receive(rfc5322({ messageId: '1@acme.example' }));
  await t.receive(rfc5322({ messageId: '2@acme.example' }));
  const latest = await t.changes(`mailbox=${DESK}&after=latest`);
  assert.deepEqual(latest.body, { cursor: '2', messages: [] });

  await t.receive(rfc5322({ messageId: '3@acme.example', subject: 'New' }));
  const next = await t.changes(`mailbox=${DESK}&after=${latest.body.cursor}`);
  assert.deepEqual(next.body.messages.map((m) => m.id), [t.rows("message_id = '3@acme.example'")[0].id]);

  const empty = setup();
  assert.deepEqual((await empty.changes(`mailbox=${DESK}&after=latest`)).body, { cursor: '0', messages: [] });
});

test('changes answers 400 for a missing mailbox or a bad after', async () => {
  const t = setup();
  for (const query of ['after=0', `mailbox=${DESK}`, `mailbox=${DESK}&after=abc`, `mailbox=${DESK}&after=-1`, 'mailbox=not-an-address&after=0']) {
    const r = await t.changes(query);
    assert.equal(r.status, 400, query);
    assert.equal(r.body.code, 'BAD_INPUT');
  }
});

// The token

test('every /v1 route answers 401 without the token or with a wrong one; /health is open', async () => {
  const t = setup();
  const routes = [
    ['GET', `/v1/changes?mailbox=${DESK}&after=0`],
    ['GET', '/v1/messages'],
    ['GET', '/v1/messages/x'],
    ['GET', '/v1/threads/x'],
    ['POST', '/v1/send', email()],
    ['GET', '/v1/status'],
    ['GET', '/v1/suppressions'],
    ['POST', '/v1/suppressions', { address: 'jo@acme.example' }],
    ['DELETE', '/v1/suppressions/jo%40acme.example'],
    ['GET', '/v1/nothing-here'],
  ];
  const wrong = [
    { token: null },
    { token: `${TOKEN}x` },
    { token: TOKEN.slice(0, -1) },
    { authorization: `Basic ${TOKEN}` },
    { authorization: TOKEN },
  ];
  for (const [method, url, body] of routes) {
    for (const auth of wrong) {
      const r = await t.api(method, url, body, auth);
      assert.equal(r.status, 401, `${method} ${url} ${JSON.stringify(auth)}`);
      assert.equal(r.body.code, 'UNAUTHORISED');
    }
  }
  assert.equal(t.EMAIL.attempts, 0);
  assert.equal(t.count('suppressions'), 0);

  assert.deepEqual(await t.api('GET', '/health', undefined, { token: null }), { status: 200, body: { ok: true } });

  // Without the secret set, /v1 says so rather than letting anyone in.
  const unset = setup({ MAIL_API_TOKEN: undefined });
  const r = await unset.api('GET', '/v1/status');
  assert.equal(r.status, 503);
  assert.equal(r.body.code, 'NO_TOKEN');
});

// Sending

test('an accepted send is stored as sent with the Message-ID Email Sending returned', async () => {
  const t = setup();
  const r = await t.api('POST', '/v1/send', email());
  assert.equal(r.status, 200);
  const [row] = t.rows();
  assert.deepEqual(r.body, { id: row.id, message_id: 'sent-1@mail.example.test', status: 'sent' });
  assert.equal(row.status, 'sent');
  assert.equal(row.direction, 'out');
  assert.equal(row.message_id, 'sent-1@mail.example.test');
  assert.equal(row.key, 'first-touch:brand:acme');
  assert.equal(row.first_touch, 1);
  assert.ok(row.sent_at);
  assert.equal(t.EMAIL.sent.length, 1);
  const [sent] = t.EMAIL.sent;
  assert.deepEqual(sent.from, { email: DESK, name: 'Desk at Example' });
  assert.deepEqual(sent.to, ['jo@acme.example']);
  assert.equal(sent.subject, 'An idea for Acme');
  assert.equal(sent.headers['X-Desk-Mail-Id'], row.id);
  assert.equal(sent.headers['In-Reply-To'], undefined);
});

test('the text is sent exactly as given, with no signature, trimming or changes', async () => {
  const t = setup();
  const text = '  Hi Jo,\r\n\r\n> not a quote, just a line\n\tTabbed — and “quoted” ✓\n\n-- \nDesk\nhttps://example.test\n\n\n  ';
  const html = '<p>Hi Jo,</p>\n<p>— Desk</p>  ';
  const r = await t.api('POST', '/v1/send', email({ text, html }));
  assert.equal(r.status, 200);
  assert.equal(t.EMAIL.sent[0].text, text);
  assert.equal(t.EMAIL.sent[0].html, html);
  assert.equal(t.rows()[0].text, text);
  assert.equal(t.rows()[0].html, html);

  // A reply too.
  await t.receive(rfc5322({ messageId: 'jo-1@acme.example', subject: 'Re: An idea for Acme' }));
  const parent = t.rows("direction = 'in'")[0];
  const reply = await t.api('POST', '/v1/send', { key: 'reply:1', from: DESK, reply_to: parent.id, text: 'Thanks!\n\n', approved: true });
  assert.equal(reply.status, 200);
  assert.equal(t.EMAIL.sent[1].text, 'Thanks!\n\n');
});

test('a reply carries In-Reply-To and References and threads with its parent', async () => {
  const t = setup();
  await t.receive(rfc5322({
    subject: 'RE: Re: Partnership',
    messageId: 'jo-2@acme.example',
    inReplyTo: 'ours-1@mail.example.test',
    references: '<ours-0@mail.example.test> <ours-1@mail.example.test>',
    headers: { 'Reply-To': 'Jo Bloggs <jo.bloggs@acme.example>' },
  }));
  const parent = t.rows()[0];
  const r = await t.api('POST', '/v1/send', { key: 'reply:jo-2', from: DESK, reply_to: parent.id, text: 'Yes, Tuesday works.', approved: true });
  assert.equal(r.status, 200);

  const [sent] = t.EMAIL.sent;
  assert.deepEqual(sent.to, ['jo.bloggs@acme.example']);
  assert.equal(sent.subject, 'Re: Partnership');
  assert.equal(sent.headers['In-Reply-To'], '<jo-2@acme.example>');
  assert.equal(sent.headers.References, '<ours-0@mail.example.test> <ours-1@mail.example.test> <jo-2@acme.example>');

  const row = t.rows("direction = 'out'")[0];
  assert.equal(row.thread_id, parent.thread_id);
  assert.equal(row.in_reply_to, 'jo-2@acme.example');
  assert.equal(row.refs, 'ours-0@mail.example.test ours-1@mail.example.test jo-2@acme.example');
  assert.equal(row.first_touch, 0);

  // A follow-up to our own email goes to its recipients, in the same thread.
  const follow = await t.api('POST', '/v1/send', { key: 'follow-up:1', from: DESK, reply_to: row.id, text: 'One more thing.', approved: true });
  assert.equal(follow.status, 200);
  assert.deepEqual(t.EMAIL.sent[1].to, ['jo.bloggs@acme.example']);
  assert.equal(t.EMAIL.sent[1].subject, 'Re: Partnership');
  assert.equal(t.EMAIL.sent[1].headers['In-Reply-To'], `<${r.body.message_id}>`);
  assert.equal(t.rows("key = 'follow-up:1'")[0].thread_id, parent.thread_id);

  const thread = await t.api('GET', `/v1/threads/${parent.thread_id}`);
  assert.deepEqual(thread.body.messages.map((m) => m.direction), ['in', 'out', 'out']);
});

test('refused: a send without approved: true', async () => {
  const t = setup();
  for (const approved of [undefined, false, 'yes', 1]) {
    const r = await t.api('POST', '/v1/send', email({ approved }));
    assert.equal(r.status, 409);
    assert.equal(r.body.code, 'NEEDS_APPROVAL');
  }
  assert.equal(t.EMAIL.attempts, 0);
  assert.equal(t.count(), 0);
});

test('refused: a sender not in SENDERS', async () => {
  const t = setup();
  for (const from of [HELLO, 'someone@else.example', 'constructor', '', undefined]) {
    const r = await t.api('POST', '/v1/send', email({ from }));
    assert.equal(r.status, 400, String(from));
    assert.equal(r.body.code, 'SENDER');
  }
  assert.equal(t.EMAIL.attempts, 0);
  assert.equal(t.count(), 0);
});

test('refused: a suppressed recipient in to, cc or bcc, matched in any case', async () => {
  const t = setup();
  const added = await t.api('POST', '/v1/suppressions', { address: 'Jo+News@ACME.example', reason: 'asked not to be contacted' });
  assert.equal(added.status, 201);
  assert.deepEqual(added.body, { address: 'jo@acme.example', reason: 'asked not to be contacted' });
  const cases = [
    { to: ['JO@ACME.EXAMPLE'] },
    { to: ['ann@acme.example'], cc: ['Jo@Acme.Example'] },
    { to: ['ann@acme.example'], bcc: ['jo+deals@acme.example'] },
  ];
  for (const fields of cases) {
    const r = await t.api('POST', '/v1/send', email(fields));
    assert.equal(r.status, 409, JSON.stringify(fields));
    assert.equal(r.body.code, 'SUPPRESSED');
    assert.deepEqual(r.body.addresses, ['jo@acme.example']);
  }
  assert.equal(t.EMAIL.attempts, 0);
  assert.equal(t.count(), 0);
});

test('refused: a key already sent or sending', async () => {
  // With the daily cap used up by the first send, a retry is still told it's a duplicate.
  const t = setup({ DAILY_SEND_LIMIT: 1 });
  const first = await t.api('POST', '/v1/send', email({ key: 'reply:42' }));
  assert.equal(first.status, 200);
  const again = await t.api('POST', '/v1/send', email({ key: 'reply:42', text: 'A different version' }));
  assert.equal(again.status, 409);
  assert.equal(again.body.code, 'DUPLICATE');
  assert.equal(again.body.id, first.body.id);
  assert.equal(again.body.status, 'sent');

  // One still being handed to Email Sending holds its key too.
  t.sqlite.exec(`INSERT INTO messages (seq, id, direction, mailbox, thread_id, from_addr, to_addrs, status, key)
    VALUES (99, 'in-flight', 'out', '${DESK}', 'in-flight', '${DESK}', 'ann@acme.example', 'sending', 'reply:43')`);
  const busy = await t.api('POST', '/v1/send', email({ key: 'reply:43' }));
  assert.equal(busy.status, 409);
  assert.equal(busy.body.code, 'DUPLICATE');
  assert.equal(busy.body.id, 'in-flight');

  assert.equal(t.EMAIL.sent.length, 1);
  assert.equal(t.count(), 2);
});

test('refused: two sends with one key at the same moment send once', async () => {
  // Called side by side, both get past the key lookup; the database lets only one store.
  const t = setup();
  const attempt = () => send(t.env, email({ key: 'reply:race' })).then(
    (ok) => ({ status: 200, body: ok }),
    (error) => ({ status: error.status, body: { code: error.code, ...error.extra } }),
  );
  const answers = await Promise.all([attempt(), attempt()]);
  assert.deepEqual(answers.map((a) => a.status).sort(), [200, 409]);
  const refused = answers.find((a) => a.status === 409);
  assert.equal(refused.body.code, 'DUPLICATE');
  assert.equal(refused.body.id, answers.find((a) => a.status === 200).body.id);
  assert.equal(t.EMAIL.sent.length, 1);
  assert.equal(t.count(), 1);
});

test('refused: a send past the daily cap, shared by every sender', async () => {
  const t = setup({ DAILY_SEND_LIMIT: 1, SENDERS: { [DESK]: 'Desk', 'other@mail.example.test': 'Other desk' } });
  assert.equal((await t.api('POST', '/v1/send', email({ key: 'a' }))).status, 200);
  const r = await t.api('POST', '/v1/send', email({ key: 'b', from: 'other@mail.example.test', to: ['ann@else.example'] }));
  assert.equal(r.status, 429);
  assert.equal(r.body.code, 'CAP');
  assert.equal(r.body.cap, 'daily');
  assert.equal(r.body.setting, 'DAILY_SEND_LIMIT');
  assert.equal(t.EMAIL.attempts, 1);
  assert.equal(t.count(), 1);
});

test('refused: a send past the monthly cap', async () => {
  const t = setup({ MONTHLY_SEND_LIMIT: 2 });
  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
  const lastMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1) - 1000).toISOString();
  const seed = (id, at) => t.sqlite.prepare(`INSERT INTO messages (seq, id, direction, mailbox, thread_id, from_addr, to_addrs, status, created_at, sent_at)
    VALUES ((SELECT coalesce(max(seq), 0) + 1 FROM messages), ?1, 'out', ?2, ?1, ?2, 'old@else.example', 'sent', ?3, ?3)`).run(id, DESK, at);
  seed('last-month', lastMonth);
  seed('this-month', monthStart);
  assert.equal((await t.api('POST', '/v1/send', email({ key: 'a' }))).status, 200);
  const r = await t.api('POST', '/v1/send', email({ key: 'b' }));
  assert.equal(r.status, 429);
  assert.equal(r.body.cap, 'monthly');
  assert.equal(t.EMAIL.attempts, 1);
});

test('refused: a first touch past the daily first-touch cap; replies and known people still go', async () => {
  const t = setup({ FIRST_TOUCH_DAILY_LIMIT: 1 });
  assert.equal((await t.api('POST', '/v1/send', email({ key: 'a', to: ['new1@else.example'] }))).status, 200);
  const r = await t.api('POST', '/v1/send', email({ key: 'b', to: ['new2@else.example'] }));
  assert.equal(r.status, 429);
  assert.equal(r.body.cap, 'first_touch_daily');
  assert.equal(r.body.setting, 'FIRST_TOUCH_DAILY_LIMIT');

  // Jo has written to the desk, so a new email to Jo isn't a first touch.
  await t.receive(rfc5322({ messageId: 'jo-1@acme.example' }));
  assert.equal((await t.api('POST', '/v1/send', email({ key: 'c', to: ['jo@acme.example'] }))).status, 200);
  // A reply isn't one either.
  const parent = t.rows("direction = 'in'")[0];
  assert.equal((await t.api('POST', '/v1/send', { key: 'd', from: DESK, reply_to: parent.id, text: 'Thanks', approved: true })).status, 200);
  assert.deepEqual(t.rows("direction = 'out'").map((m) => m.first_touch), [1, 0, 0]);
});

test('refused: bad input', async () => {
  const t = setup();
  const cases = [
    email({ key: undefined }),
    email({ key: '  ' }),
    email({ text: undefined }),
    email({ text: '   \n' }),
    email({ subject: undefined }),
    email({ to: [] }),
    email({ to: ['Jo <jo@acme.example>'] }),
    email({ cc: 'not-an-address' }),
    email({ replyTo: 'x' }),
    email({ reply_to: 'no-such-message' }),
  ];
  for (const body of cases) {
    const r = await t.api('POST', '/v1/send', body);
    assert.equal(r.status, 400, JSON.stringify(body));
    assert.equal(r.body.code, 'BAD_INPUT');
  }
  const notJson = await worker.fetch(new Request('https://mail.example.test/v1/send', {
    method: 'POST', headers: { authorization: `Bearer ${TOKEN}` }, body: '{not json',
  }), t.env, {});
  assert.equal(notJson.status, 400);
  assert.equal(t.EMAIL.attempts, 0);
  assert.equal(t.count(), 0);
});

test('when Email Sending refuses, the send is stored as failed and answered 502', async () => {
  const t = setup();
  t.EMAIL.failWith(providerError('E_SENDER_NOT_VERIFIED', 'sender domain is not verified'));
  const r = await t.api('POST', '/v1/send', email({ key: 'k' }));
  assert.equal(r.status, 502);
  assert.equal(r.body.code, 'SEND_FAILED');
  assert.equal(r.body.provider_code, 'E_SENDER_NOT_VERIFIED');
  assert.match(r.body.error, /sender domain is not verified/);
  const [row] = t.rows();
  assert.equal(r.body.id, row.id);
  assert.equal(row.status, 'failed');
  assert.equal(row.error, 'E_SENDER_NOT_VERIFIED: sender domain is not verified');
  assert.equal(row.message_id, null);

  // A failed send doesn't hold its key: once fixed, it can go.
  t.EMAIL.failWith(null);
  const retry = await t.api('POST', '/v1/send', email({ key: 'k' }));
  assert.equal(retry.status, 200);
  assert.deepEqual(t.rows().map((m) => m.status), ['failed', 'sent']);
});

test('a recipient Email Sending refuses as suppressed goes on the suppression list', async () => {
  const t = setup();
  t.EMAIL.failWith(providerError('E_RECIPIENT_SUPPRESSED', 'recipient is on the suppression list'));
  const r = await t.api('POST', '/v1/send', email({ to: ['Gone@Acme.example'] }));
  assert.equal(r.status, 502);
  const list = await t.api('GET', '/v1/suppressions');
  assert.deepEqual(list.body.suppressions.map((s) => [s.address, s.reason]), [['gone@acme.example', 'suppressed by Email Sending']]);
});

// Reading

test('messages, one message, threads, status and suppressions answer', async () => {
  const t = setup({ DAILY_SEND_LIMIT: 10 });
  await t.receive(rfc5322({
    messageId: 'jo-1@acme.example',
    subject: 'Question',
    text: 'Can we talk Tuesday?\n\nOn Mon, 26 Oct 2026 at 09:00, Desk at Example <\ndesk@mail.example.test> wrote:\n> Earlier note\n',
  }));
  await t.receive(rfc5322({ messageId: 'n@acme.example', subject: 'News', headers: { 'List-Id': '<news.acme.example>' } }), { to: HELLO });
  const parent = t.rows()[0];
  await t.api('POST', '/v1/send', { key: 'reply:jo-1', from: DESK, reply_to: parent.id, text: 'Tuesday is good.', approved: true });

  const all = await t.api('GET', '/v1/messages');
  assert.deepEqual(all.body.messages.map((m) => m.subject), ['Re: Question', 'News', 'Question']);
  assert.equal(all.body.messages[2].snippet.startsWith('Can we talk Tuesday?'), true);
  assert.equal('text' in all.body.messages[2], false);

  const filtered = async (query) => (await t.api('GET', `/v1/messages?${query}`)).body.messages.map((m) => m.subject);
  assert.deepEqual(await filtered(`mailbox=${HELLO}`), ['News']);
  assert.deepEqual(await filtered('direction=out'), ['Re: Question']);
  assert.deepEqual(await filtered('auto=1'), ['News']);
  assert.deepEqual(await filtered('own=0&direction=in&auto=0'), ['Question']);
  assert.deepEqual(await filtered(`thread=${parent.thread_id}`), ['Re: Question', 'Question']);
  assert.deepEqual(await filtered('key=reply:jo-1'), ['Re: Question']);
  assert.deepEqual(await filtered('q=tuesday'), ['Re: Question', 'Question']);
  assert.deepEqual(await filtered('limit=1'), ['Re: Question']);
  assert.equal((await t.api('GET', '/v1/messages?direction=sideways')).status, 400);

  const one = await t.api('GET', `/v1/messages/${parent.id}`);
  assert.equal(one.body.fresh, 'Can we talk Tuesday?');
  assert.equal(one.body.thread, parent.thread_id);
  assert.equal(one.body.from, 'jo@acme.example');
  assert.equal((await t.api('GET', '/v1/messages/nope')).status, 404);

  const thread = await t.api('GET', `/v1/threads/${parent.thread_id}`);
  assert.deepEqual(thread.body.messages.map((m) => m.subject), ['Question', 'Re: Question']);
  assert.equal((await t.api('GET', '/v1/threads/nope')).status, 404);

  const status = await t.api('GET', '/v1/status');
  assert.equal(status.status, 200);
  assert.deepEqual(status.body.sends, { today: 1, first_touches_today: 0, this_month: 1 });
  assert.deepEqual(status.body.caps.daily, { used: 1, limit: 10, setting: 'DAILY_SEND_LIMIT' });
  assert.deepEqual(status.body.inbox[DESK], { total: 1, today: 1, auto: 0, own: 0 });
  assert.deepEqual(status.body.inbox[HELLO], { total: 1, today: 1, auto: 1, own: 0 });
  assert.deepEqual(status.body.mailboxes, [DESK, HELLO]);
  assert.equal(status.body.cursor, '3');

  await t.api('POST', '/v1/suppressions', { address: 'ann@acme.example' });
  assert.deepEqual((await t.api('GET', '/v1/suppressions')).body.suppressions.map((s) => [s.address, s.reason]), [['ann@acme.example', 'never contact']]);
  assert.deepEqual((await t.api('DELETE', '/v1/suppressions/Ann%40Acme.example')).body, { address: 'ann@acme.example', removed: true });
  assert.deepEqual((await t.api('GET', '/v1/suppressions')).body.suppressions, []);
});

test('settings given as JSON strings (.dev.vars) work too, and a missing cap stops sending', async () => {
  const t = setup({
    MAILBOXES: JSON.stringify([DESK]),
    SENDERS: JSON.stringify({ [DESK]: 'Desk' }),
    FORWARD_TO: '[]',
    DAILY_SEND_LIMIT: '60',
  });
  const message = await t.receive(rfc5322({ messageId: 'jo-1@acme.example' }));
  assert.deepEqual(message.forwards, []);
  assert.equal((await t.api('POST', '/v1/send', email())).status, 200);

  const noCap = setup({ DAILY_SEND_LIMIT: undefined });
  const r = await noCap.api('POST', '/v1/send', email());
  assert.equal(r.status, 500);
  assert.equal(r.body.code, 'SETTINGS');
  assert.match(r.body.error, /DAILY_SEND_LIMIT/);
  assert.equal(noCap.EMAIL.attempts, 0);
});

test('helpers: Re: once, and the fresh text without quoted history', () => {
  assert.equal(replySubject('Hello'), 'Re: Hello');
  assert.equal(replySubject('RE: Re: AW: Hello'), 'Re: Hello');
  assert.equal(replySubject('Fwd: Hello'), 'Re: Fwd: Hello');
  assert.equal(freshText('Sounds good.\n\nOn Tue, 14 Oct 2026 at 10:00, Desk wrote:\n> Hello'), 'Sounds good.');
  assert.equal(freshText('Fine.\n\nFrom: Desk <desk@mail.example.test>\nSent: Tuesday\nSubject: x'), 'Fine.');
  assert.equal(freshText('Fine.\n\n-----Original Message-----\nold'), 'Fine.');
  assert.equal(freshText('No quotes here.\n'), 'No quotes here.');
});
