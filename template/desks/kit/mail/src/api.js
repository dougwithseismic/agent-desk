// The HTTP API. Every /v1 route takes Authorization: Bearer <MAIL_API_TOKEN>; GET /health
// is open. The mail contract (GET /v1/changes) is the one desk.mjs watch speaks.

import {
  MailError, addressesOf, badInput, canonicalAddress, cap, forwardTo, freshText, isEmail, mailboxes,
  messageIds, senders, snippet, unique,
} from './mail.js';
import { CAPS, periods, send } from './outbound.js';
import {
  changesAfter, getMessage, inboxCounts, latestSeq, listMessages, listSuppressions, sendCounts,
  suppress, threadMessages, unsuppress,
} from './store.js';

const json = (body, status = 200, headers = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers },
  });

// Authorisation

const encoder = new TextEncoder();

/** Compares two secrets in constant time, by their SHA-256 digests. */
async function sameSecret(a, b) {
  const [x, y] = await Promise.all([a, b].map((s) => crypto.subtle.digest('SHA-256', encoder.encode(s))));
  const p = new Uint8Array(x);
  const q = new Uint8Array(y);
  let diff = 0;
  for (let i = 0; i < p.length; i++) diff |= p[i] ^ q[i];
  return diff === 0;
}

async function refusal(request, env) {
  const expected = typeof env.MAIL_API_TOKEN === 'string' ? env.MAIL_API_TOKEN : '';
  if (expected.length < 32) {
    return json({
      error: 'MAIL_API_TOKEN is not set, or is shorter than 32 characters: set it with wrangler secret put MAIL_API_TOKEN',
      code: 'NO_TOKEN',
    }, 503);
  }
  const given = (request.headers.get('authorization') ?? '').match(/^Bearer\s+(\S+)\s*$/i)?.[1] ?? '';
  if (!given || !(await sameSecret(given, expected))) {
    return json({ error: 'Unauthorised: send Authorization: Bearer <MAIL_API_TOKEN>', code: 'UNAUTHORISED' }, 401, {
      'www-authenticate': 'Bearer',
    });
  }
  return null;
}

// Query helpers

function whole(value, fallback, min, max) {
  const n = value === null || value.trim() === '' ? Number.NaN : Number(value);
  return Number.isInteger(n) ? Math.min(Math.max(n, min), max) : fallback;
}

function flag(url, name) {
  const value = url.searchParams.get(name);
  if (value === null || value === '') return undefined;
  if (['1', 'true'].includes(value)) return true;
  if (['0', 'false'].includes(value)) return false;
  throw badInput(`${name} must be 1 or 0`);
}

function mailboxParams(url) {
  const boxes = unique(url.searchParams.getAll('mailbox').flatMap((v) => v.split(',')).map(canonicalAddress).filter(Boolean));
  const bad = boxes.filter((b) => !isEmail(b));
  if (bad.length) throw badInput(`Not an address: ${bad.join(', ')}`);
  return boxes;
}

async function body(request) {
  try {
    return await request.json();
  } catch {
    throw badInput('Send a JSON body');
  }
}

const parseJson = (value) => {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
};

/** A stored row as the API shows it. `text`: 'full', 'snippet' or 'none'. */
function present(row, { text = 'full', html = true } = {}) {
  const out = {
    id: row.id,
    direction: row.direction,
    mailbox: row.mailbox,
    thread: row.thread_id,
    message_id: row.message_id ?? null,
    in_reply_to: row.in_reply_to ?? null,
    references: messageIds(row.refs),
    from: row.from_addr,
    from_name: row.from_name ?? null,
    to: addressesOf(row.to_addrs),
    cc: addressesOf(row.cc_addrs),
    bcc: addressesOf(row.bcc_addrs),
    subject: row.subject,
    status: row.status,
    error: row.error ?? null,
    key: row.key ?? null,
    first_touch: row.first_touch === 1,
    auto: row.auto === 1,
    own: row.own === 1,
    attachments: parseJson(row.attachments) ?? [],
    created_at: row.created_at,
    sent_at: row.sent_at ?? null,
  };
  if (text === 'snippet') out.snippet = snippet(row.text);
  if (text === 'full') {
    out.text = row.text ?? null;
    out.fresh = freshText(row.text);
  }
  if (html && 'html' in row) out.html = row.html ?? null;
  if ('headers' in row) out.headers = parseJson(row.headers) ?? {};
  return out;
}

// Routes

async function changes({ env, url }) {
  const boxes = mailboxParams(url);
  if (!boxes.length) throw badInput('mailbox is required: ?mailbox=<address>, once for each address');
  const after = url.searchParams.get('after');
  if (after === 'latest') return json({ cursor: String(await latestSeq(env.DB)), messages: [] });
  if (after === null || !/^\d{1,15}$/.test(after)) {
    throw badInput('after must be a cursor from an earlier answer, or latest');
  }
  const limit = whole(url.searchParams.get('limit'), 50, 1, 100);
  const rows = await changesAfter(env.DB, boxes, Number(after), limit);
  return json({
    cursor: rows.length ? String(rows.at(-1).seq) : after,
    messages: rows.map((r) => ({
      id: r.id,
      mailbox: r.mailbox,
      thread: r.thread_id,
      from: r.from_addr,
      received_at: r.created_at,
      auto: r.auto === 1,
    })),
  });
}

async function messages({ env, url }) {
  const direction = url.searchParams.get('direction') || undefined;
  if (direction && !['in', 'out'].includes(direction)) throw badInput('direction must be in or out');
  const rows = await listMessages(env.DB, {
    mailboxes: mailboxParams(url),
    direction,
    auto: flag(url, 'auto'),
    own: flag(url, 'own'),
    thread: url.searchParams.get('thread') || undefined,
    key: url.searchParams.get('key') || undefined,
    q: url.searchParams.get('q')?.trim() || undefined,
    limit: whole(url.searchParams.get('limit'), 30, 1, 200),
  });
  return json({ messages: rows.map((r) => present(r, { text: 'snippet', html: false })) });
}

async function message({ env, params: [id] }) {
  const row = await getMessage(env.DB, id);
  if (!row) return json({ error: `No message ${id}`, code: 'NOT_FOUND' }, 404);
  return json(present(row));
}

async function thread({ env, params: [id] }) {
  const rows = await threadMessages(env.DB, id);
  if (!rows.length) return json({ error: `No thread ${id}`, code: 'NOT_FOUND' }, 404);
  return json({ thread: rows[0].thread_id, messages: rows.map((r) => present(r, { html: false })) });
}

async function sendRoute({ env, request }) {
  return json(await send(env, await body(request)));
}

async function status({ env }) {
  const { day, month } = periods();
  const [today, thisMonth, inbox, cursor] = await Promise.all([
    sendCounts(env.DB, day),
    sendCounts(env.DB, month),
    inboxCounts(env.DB, day),
    latestSeq(env.DB),
  ]);
  const used = { daily: today.sends, first_touch_daily: today.firstTouches, monthly: thisMonth.sends };
  return json({
    mailboxes: mailboxes(env),
    senders: senders(env),
    forward_to: forwardTo(env),
    cursor: String(cursor),
    sends: { today: today.sends, first_touches_today: today.firstTouches, this_month: thisMonth.sends },
    caps: Object.fromEntries(Object.entries(CAPS).map(([name, setting]) => [
      name, { used: used[name], limit: cap(env, setting), setting },
    ])),
    inbox: Object.fromEntries(inbox.map((r) => [r.mailbox, { total: r.total, today: r.today, auto: r.auto, own: r.own }])),
  });
}

async function suppressions({ env }) {
  return json({ suppressions: await listSuppressions(env.DB) });
}

async function addSuppression({ env, request }) {
  const input = await body(request);
  const address = canonicalAddress(input?.address);
  if (!isEmail(address)) throw badInput('address is required: { "address": "jo@acme.com", "reason": "..." }');
  const reason = typeof input.reason === 'string' && input.reason.trim() ? input.reason.trim() : 'never contact';
  await suppress(env.DB, address, reason);
  return json({ address, reason }, 201);
}

async function removeSuppression({ env, params: [given] }) {
  const address = canonicalAddress(given);
  return json({ address, removed: await unsuppress(env.DB, address) });
}

const ROUTES = [
  ['GET', /^\/health$/, async () => json({ ok: true })],
  ['GET', /^\/v1\/changes$/, changes],
  ['GET', /^\/v1\/messages$/, messages],
  ['GET', /^\/v1\/messages\/([^/]+)$/, message],
  ['GET', /^\/v1\/threads\/([^/]+)$/, thread],
  ['POST', /^\/v1\/send$/, sendRoute],
  ['GET', /^\/v1\/status$/, status],
  ['GET', /^\/v1\/suppressions$/, suppressions],
  ['POST', /^\/v1\/suppressions$/, addSuppression],
  ['DELETE', /^\/v1\/suppressions\/([^/]+)$/, removeSuppression],
];

/** The Worker's fetch handler. */
export async function handleFetch(request, env) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, '') || '/';
  try {
    if (path === '/v1' || path.startsWith('/v1/')) {
      const refused = await refusal(request, env);
      if (refused) return refused;
    }
    const matching = ROUTES.filter(([, pattern]) => pattern.test(path));
    if (!matching.length) return json({ error: 'Not found', code: 'NOT_FOUND' }, 404);
    const route = matching.find(([method]) => method === request.method);
    if (!route) {
      return json({ error: 'Method not allowed', code: 'METHOD' }, 405, { allow: matching.map(([m]) => m).join(', ') });
    }
    let params;
    try {
      params = path.match(route[1]).slice(1).map(decodeURIComponent);
    } catch {
      throw badInput('Bad address in the path');
    }
    return await route[2]({ request, env, url, params });
  } catch (error) {
    if (error instanceof MailError) {
      return json({ error: error.message, code: error.code, ...error.extra }, error.status);
    }
    console.error(JSON.stringify({ event: 'api.error', path, error: String(error?.message ?? error) }));
    return json({ error: 'Internal error', code: 'INTERNAL' }, 500);
  }
}
