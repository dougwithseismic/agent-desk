// Inbound mail: Email Routing hands every email for a routed address to `handleEmail`.

import PostalMime from '../vendor/postal-mime/postal-mime.js';
import {
  canonicalAddress, forwardTo, isAutomatic, mailboxes, messageIds, normalAddress, sameSubject,
  senders, stripBrackets, unique,
} from './mail.js';
import { findByMessageIds, insertInbound, recentSendsTo } from './store.js';

// Headers kept with each email, to judge it by later: auto-replies, lists, spam verdicts.
const KEPT_HEADERS = [
  'auto-submitted',
  'x-autoreply',
  'x-autorespond',
  'x-ms-exchange-inbox-rules-loop',
  'precedence',
  'list-id',
  'list-unsubscribe',
  'list-unsubscribe-post',
  'content-type',
  'reply-to',
  'return-path',
  'authentication-results',
  'received-spf',
  'x-failed-recipients',
];

// D1 caps a row at 2 MB. Long text and HTML are cut; the forwarded copy has the whole email.
const MAX_TEXT = 200_000;
const MAX_HTML = 500_000;
const MAX_SUBJECT = 1_000;

const log = (event, fields) => console.log(JSON.stringify({ event, ...fields }));

const mailboxesIn = (addresses) => (addresses ?? []).flatMap((a) => (a.group ? a.group : [a]));

/**
 * Stores one inbound email and threads it. Refuses (setReject) mail for an address that
 * isn't one of MAILBOXES and stores nothing. Throws when it can't store, so Email Routing
 * retries or reports it.
 * Returns { id } when stored, { duplicate: true } when this mailbox already has it, or
 * { rejected: true }.
 */
export async function receive(message, env) {
  const own = mailboxes(env);
  const mailbox = canonicalAddress(message.to);
  if (!own.includes(mailbox)) {
    message.setReject('Address not found');
    log('email.rejected', { to: mailbox });
    return { rejected: true };
  }
  const ours = Object.keys(senders(env)).map(canonicalAddress);

  // Read the raw message once. A message postal-mime can't read is still stored, from
  // its envelope, with the parser's words as the error.
  const raw = await new Response(message.raw).arrayBuffer();
  let email;
  let error = null;
  try {
    email = await PostalMime.parse(raw);
  } catch (e) {
    email = { headers: [], attachments: [] };
    error = `Couldn't parse this email: ${e?.message ?? e}`;
  }

  const fromBox = mailboxesIn(email.from ? [email.from] : [])[0];
  const from = normalAddress(fromBox?.address || message.from);
  const to = unique(mailboxesIn(email.to).map((m) => normalAddress(m.address)).filter(Boolean));
  const cc = unique(mailboxesIn(email.cc).map((m) => normalAddress(m.address)).filter(Boolean));
  const subject = (email.subject ?? '').slice(0, MAX_SUBJECT);

  const headers = new Map();
  for (const h of email.headers ?? []) {
    if (KEPT_HEADERS.includes(h.key) && !headers.has(h.key)) headers.set(h.key, h.value);
  }
  // An alias send BCC'd to the desk: our own copy, kept but left out of the changes feed.
  const isOwn = ours.includes(canonicalAddress(from));
  const auto = !isOwn && isAutomatic(headers, from, subject);

  // Thread: the email it answers (In-Reply-To, then References, newest first), else our
  // latest email to this sender with the same subject.
  const inReplyTo = messageIds(email.inReplyTo)[0] ?? null;
  const refs = messageIds(email.references);
  let parent = await findByMessageIds(env.DB, unique([inReplyTo, ...refs.toReversed()].filter(Boolean)));
  if (!parent && !isOwn && subject) {
    parent = (await recentSendsTo(env.DB, from)).find((m) => sameSubject(m.subject, subject)) ?? null;
  }

  const id = crypto.randomUUID();
  const stored = await insertInbound(env.DB, {
    id,
    direction: 'in',
    mailbox,
    thread_id: parent?.thread_id ?? id,
    message_id: email.messageId ? stripBrackets(email.messageId) || null : null,
    in_reply_to: inReplyTo,
    refs: refs.length ? refs.join(' ') : null,
    from_addr: from,
    from_name: fromBox?.name || null,
    to_addrs: to.join(',') || mailbox,
    cc_addrs: cc.join(',') || null,
    subject,
    text: email.text?.slice(0, MAX_TEXT) ?? null,
    html: email.html?.slice(0, MAX_HTML) ?? null,
    attachments: email.attachments.length
      ? JSON.stringify(email.attachments.map((a) => ({
          filename: a.filename,
          type: a.mimeType,
          size: typeof a.content === 'string' ? a.content.length : a.content.byteLength,
        })))
      : null,
    headers: headers.size ? JSON.stringify(Object.fromEntries(headers)) : null,
    status: 'received',
    error,
    first_touch: 0,
    auto: auto ? 1 : 0,
    own: isOwn ? 1 : 0,
  });
  if (!stored) {
    log('email.duplicate', { mailbox });
    return { duplicate: true };
  }
  log('email.received', { id, mailbox, auto, own: isOwn });
  return { id };
}

/**
 * The Worker's email handler: store first, then forward a copy to each FORWARD_TO.
 * A storage failure throws (nothing is forwarded, and Email Routing retries or reports
 * it). A forward failure is logged only: the email is kept either way.
 */
export async function handleEmail(message, env) {
  const destinations = forwardTo(env);
  let result;
  try {
    result = await receive(message, env);
  } catch (error) {
    console.error(JSON.stringify({ event: 'email.store_failed', to: normalAddress(message.to), error: String(error?.message ?? error) }));
    throw error;
  }
  if (!result.id) return result;
  for (const address of destinations) {
    try {
      await message.forward(address);
    } catch (error) {
      console.error(JSON.stringify({ event: 'email.forward_failed', id: result.id, address, error: String(error?.message ?? error) }));
    }
  }
  return result;
}
