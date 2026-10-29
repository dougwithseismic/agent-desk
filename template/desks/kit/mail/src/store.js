// D1 access. Every SQL statement lives here.

const COLUMNS = [
  'id', 'direction', 'mailbox', 'thread_id', 'message_id', 'in_reply_to', 'refs', 'from_addr',
  'from_name', 'to_addrs', 'cc_addrs', 'bcc_addrs', 'subject', 'text', 'html', 'attachments',
  'headers', 'status', 'error', 'key', 'first_touch', 'auto', 'own',
];

// seq is set inside the statement, so it follows the order rows are committed in.
const INSERT = `INSERT INTO messages (seq, ${COLUMNS.join(', ')})
  SELECT (SELECT coalesce(max(seq), 0) + 1 FROM messages), ${COLUMNS.map((_, i) => `?${i + 1}`).join(', ')}`;

const DEFAULTS = { subject: '', first_touch: 0, auto: 0, own: 0 };
const values = (row) => COLUMNS.map((c) => row[c] ?? DEFAULTS[c] ?? null);

/** Stores an inbound email unless this mailbox already has one with its Message-ID. True when stored. */
export async function insertInbound(db, row) {
  const result = await db
    .prepare(`${INSERT} WHERE ?5 IS NULL OR NOT EXISTS (
      SELECT 1 FROM messages WHERE direction = 'in' AND mailbox = ?3 AND message_id = ?5)`)
    .bind(...values(row))
    .run();
  return result.meta.changes > 0;
}

/** Stores an outbound email as it's handed to Email Sending. Throws on a key already sending or sent. */
export function insertOutbound(db, row) {
  return db.prepare(INSERT).bind(...values(row)).run();
}

export const isKeyConflict = (error) => /UNIQUE constraint failed: messages\.key/.test(String(error?.message ?? error));

export function getMessage(db, id) {
  return db.prepare('SELECT * FROM messages WHERE id = ?1').bind(id).first();
}

/** The stored email with the first of `ids` (Message-IDs, most wanted first) that's known. */
export async function findByMessageIds(db, ids) {
  if (ids.length === 0) return null;
  const marks = ids.map((_, i) => `?${i + 1}`).join(', ');
  const { results } = await db
    .prepare(`SELECT * FROM messages WHERE message_id IN (${marks}) ORDER BY seq`)
    .bind(...ids)
    .all();
  for (const id of ids) {
    const hit = results.find((m) => m.message_id === id);
    if (hit) return hit;
  }
  return null;
}

/**
 * Our latest emails to `address` in the last 60 days, newest first: ones the Worker sent,
 * and our own copies of alias sends.
 */
export async function recentSendsTo(db, address) {
  const { results } = await db
    .prepare(`SELECT * FROM messages
      WHERE ((direction = 'out' AND status = 'sent') OR (direction = 'in' AND own = 1))
        AND instr(',' || to_addrs || ',' || coalesce(cc_addrs, '') || ',' || coalesce(bcc_addrs, '') || ',', ',' || ?1 || ',') > 0
        AND created_at >= ?2
      ORDER BY seq DESC LIMIT 50`)
    .bind(address, new Date(Date.now() - 60 * 86_400_000).toISOString())
    .all();
  return results;
}

/** The send that holds `key`: sending or sent. */
export function findSendByKey(db, key) {
  return db
    .prepare("SELECT * FROM messages WHERE key = ?1 AND status IN ('sending', 'sent') ORDER BY seq LIMIT 1")
    .bind(key)
    .first();
}

export function markSent(db, id, messageId) {
  return db
    .prepare("UPDATE messages SET status = 'sent', message_id = ?2, sent_at = ?3, error = NULL WHERE id = ?1")
    .bind(id, messageId, new Date().toISOString())
    .run();
}

export function markFailed(db, id, error) {
  return db.prepare("UPDATE messages SET status = 'failed', error = ?2 WHERE id = ?1").bind(id, error).run();
}

/** Inbound mail for `mailboxes` after `after` (a seq), oldest first. Own copies left out. */
export async function changesAfter(db, mailboxes, after, limit) {
  const marks = mailboxes.map((_, i) => `?${i + 3}`).join(', ');
  const { results } = await db
    .prepare(`SELECT id, seq, mailbox, thread_id, from_addr, created_at, auto FROM messages
      WHERE direction = 'in' AND own = 0 AND seq > ?1 AND mailbox IN (${marks})
      ORDER BY seq LIMIT ?2`)
    .bind(after, limit, ...mailboxes)
    .all();
  return results;
}

/** The feed's current position: the highest seq stored, or 0. */
export async function latestSeq(db) {
  const row = await db.prepare('SELECT coalesce(max(seq), 0) AS seq FROM messages').first();
  return row?.seq ?? 0;
}

const LIST_COLUMNS = `id, seq, direction, mailbox, thread_id, message_id, in_reply_to, refs, from_addr,
  from_name, to_addrs, cc_addrs, bcc_addrs, subject, substr(coalesce(text, ''), 1, 400) AS text,
  attachments, status, error, key, first_touch, auto, own, created_at, sent_at`;

/** Mail, newest first, filtered by any of: mailbox (a list), direction, auto, own, thread, key, q. */
export async function listMessages(db, query) {
  const where = [];
  const binds = [];
  const mark = (value) => {
    binds.push(value);
    return `?${binds.length}`;
  };
  if (query.mailboxes?.length) where.push(`mailbox IN (${query.mailboxes.map(mark).join(', ')})`);
  if (query.direction) where.push(`direction = ${mark(query.direction)}`);
  if (query.auto !== undefined) where.push(`auto = ${mark(query.auto ? 1 : 0)}`);
  if (query.own !== undefined) where.push(`own = ${mark(query.own ? 1 : 0)}`);
  if (query.thread) where.push(`thread_id = ${mark(query.thread)}`);
  if (query.key) where.push(`key = ${mark(query.key)}`);
  if (query.q) {
    const like = mark(`%${query.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`);
    const exact = mark(query.q.replace(/^<|>$/g, ''));
    where.push(`(message_id = ${exact} OR ${['subject', 'text', 'from_addr', 'from_name', 'to_addrs', 'cc_addrs']
      .map((c) => `${c} LIKE ${like} ESCAPE '\\'`).join(' OR ')})`);
  }
  const limit = mark(query.limit);
  const { results } = await db
    .prepare(`SELECT ${LIST_COLUMNS} FROM messages ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY seq DESC LIMIT ${limit}`)
    .bind(...binds)
    .all();
  return results;
}

/** A conversation, oldest first: by its thread id, or by the id of an email in it. */
export async function threadMessages(db, id) {
  const { results } = await db
    .prepare(`SELECT * FROM messages WHERE thread_id = coalesce((SELECT thread_id FROM messages WHERE id = ?1), ?1)
      ORDER BY seq LIMIT 500`)
    .bind(id)
    .all();
  return results;
}

/** The latest email from outside that came into a thread after `seq`, or null. */
export async function laterInThread(db, threadId, seq) {
  return db
    .prepare(`SELECT id, mailbox, from_addr, created_at FROM messages
      WHERE thread_id = ?1 AND seq > ?2 AND direction = 'in' AND own = 0 AND auto = 0 ORDER BY seq DESC LIMIT 1`)
    .bind(threadId, seq)
    .first();
}

/** Sends counted against the caps since `since` (ISO), across every sender. */
export async function sendCounts(db, since) {
  const row = await db
    .prepare(`SELECT count(*) AS sends, coalesce(sum(first_touch), 0) AS first_touches FROM messages
      WHERE direction = 'out' AND status IN ('sending', 'sent') AND coalesce(sent_at, created_at) >= ?1`)
    .bind(since)
    .first();
  return { sends: row?.sends ?? 0, firstTouches: row?.first_touches ?? 0 };
}

/** True when any of `addresses` has ever written to any of the mailboxes. */
export async function hasWritten(db, addresses) {
  if (addresses.length === 0) return false;
  const marks = addresses.map((_, i) => `?${i + 1}`).join(', ');
  const row = await db
    .prepare(`SELECT 1 AS hit FROM messages WHERE direction = 'in' AND own = 0 AND from_addr IN (${marks}) LIMIT 1`)
    .bind(...addresses)
    .first();
  return row !== null;
}

/** Inbound counts per mailbox: all, since `since`, automatic and own copies. */
export async function inboxCounts(db, since) {
  const { results } = await db
    .prepare(`SELECT mailbox, count(*) AS total, coalesce(sum(created_at >= ?1), 0) AS today,
        coalesce(sum(auto), 0) AS auto, coalesce(sum(own), 0) AS own
      FROM messages WHERE direction = 'in' GROUP BY mailbox ORDER BY mailbox`)
    .bind(since)
    .all();
  return results;
}

// Suppressions. Addresses are stored and compared lower-case without a +tag.

export async function suppressed(db, addresses) {
  if (addresses.length === 0) return [];
  const marks = addresses.map((_, i) => `?${i + 1}`).join(', ');
  const { results } = await db
    .prepare(`SELECT address, reason FROM suppressions WHERE address IN (${marks}) ORDER BY address`)
    .bind(...addresses)
    .all();
  return results;
}

export function suppress(db, address, reason) {
  return db
    .prepare(`INSERT INTO suppressions (address, reason) VALUES (?1, ?2)
      ON CONFLICT (address) DO UPDATE SET reason = excluded.reason`)
    .bind(address, reason)
    .run();
}

export async function unsuppress(db, address) {
  const result = await db.prepare('DELETE FROM suppressions WHERE address = ?1').bind(address).run();
  return result.meta.changes > 0;
}

export async function listSuppressions(db) {
  const { results } = await db.prepare('SELECT address, reason, created_at FROM suppressions ORDER BY created_at DESC, address').all();
  return results;
}
