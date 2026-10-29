// Outbound mail: sends one email a desk has approved, through the send_email binding
// (EMAIL), exactly as given. The desk decides what goes (holds, trust, approvals); the
// Worker keeps only the checks that belong to the mailbox.

import {
  MailError, addressesOf, badInput, canonicalAddress, cap, isEmail, mailboxes, normalAddress,
  replyHeaders, replySubject, senders, unique,
} from './mail.js';
import {
  findSendByKey, getMessage, hasWritten, insertOutbound, isKeyConflict, laterInThread, markFailed, markSent,
  sendCounts, suppress, suppressed,
} from './store.js';

const FIELDS = new Set(['key', 'from', 'to', 'cc', 'bcc', 'subject', 'text', 'html', 'reply_to', 'approved', 'check']);
const MAX_KEY = 500;
const MAX_RECIPIENTS = 50;

/** The caps, by name, with the setting that holds each. */
export const CAPS = {
  daily: 'DAILY_SEND_LIMIT',
  first_touch_daily: 'FIRST_TOUCH_DAILY_LIMIT',
  monthly: 'MONTHLY_SEND_LIMIT',
};

/** Midnight UTC today and the first of this month, as ISO strings. */
export function periods(now = new Date()) {
  const day = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const month = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  return { day: day.toISOString(), month: month.toISOString() };
}

function addressList(value, label) {
  if (value === undefined || value === null) return [];
  const list = typeof value === 'string' ? [value] : value;
  if (!Array.isArray(list) || list.some((v) => typeof v !== 'string')) {
    throw badInput(`${label} must be a list of addresses`);
  }
  const out = unique(list.map(normalAddress).filter(Boolean));
  const bad = out.filter((a) => !isEmail(a));
  if (bad.length) throw badInput(`Not an address in ${label}: ${bad.join(', ')}`);
  return out;
}

/** Where a reply goes: its sender (Reply-To first), or for our own email, its recipients. */
function replyRecipients(parent, own) {
  if (parent.direction === 'out' || parent.own === 1) {
    return addressesOf(parent.to_addrs).filter((a) => !own.includes(canonicalAddress(a)));
  }
  const header = parent.headers ? JSON.parse(parent.headers)['reply-to'] : undefined;
  const replyTo = header?.match(/<([^<>\s]+@[^<>\s]+)>/)?.[1] ?? header?.split(',')[0]?.trim();
  return [replyTo && isEmail(normalAddress(replyTo)) ? normalAddress(replyTo) : parent.from_addr];
}

/**
 * Sends one approved email: { key, from, to[], cc?[], bcc?[], subject?, text, html?,
 * reply_to?, approved }. Refuses, storing nothing, an email without approved: true, a
 * sender not in SENDERS, a key already sending or sent, a reply to an email the sender
 * has written again since, a suppressed recipient, or one past a cap. Otherwise it's
 * stored as sending, handed to Email Sending, and marked sent with the Message-ID it
 * returned, or failed with its error (502). With check: true it stops after the refusals,
 * storing and sending nothing, and says the subject it would send, so a desk can ask first.
 */
export async function send(env, input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw badInput('Send a JSON object');
  if (input.approved !== true) {
    throw new MailError(409, 'NEEDS_APPROVAL', 'Not approved: the Worker sends only an email approved on the desk (approved: true)');
  }
  const unknown = Object.keys(input).filter((k) => !FIELDS.has(k));
  if (unknown.length) throw badInput(`Unknown field ${unknown.join(', ')}: use ${[...FIELDS].join(', ')}`);

  if (input.check !== undefined && typeof input.check !== 'boolean') throw badInput('check must be true or false');

  const key = typeof input.key === 'string' ? input.key.trim() : '';
  if (!key) throw badInput("Every send needs a key: the desk action's key");
  if (key.length > MAX_KEY) throw badInput(`key is longer than ${MAX_KEY} characters`);

  const sendable = senders(env);
  const from = typeof input.from === 'string' ? normalAddress(input.from) : '';
  if (!Object.hasOwn(sendable, from)) {
    const list = Object.keys(sendable).join(', ') || 'none in SENDERS';
    throw new MailError(400, 'SENDER', from ? `Can't send as ${from}: not one of ${list}` : `from is required: one of ${list}`);
  }

  if (typeof input.text !== 'string' || !input.text.trim()) throw badInput('The email has no text');
  if (input.html !== undefined && input.html !== null && typeof input.html !== 'string') throw badInput('html must be a string');
  if (input.subject !== undefined && input.subject !== null && typeof input.subject !== 'string') throw badInput('subject must be a string');
  if (input.reply_to !== undefined && input.reply_to !== null && typeof input.reply_to !== 'string') throw badInput('reply_to must be a stored message id');

  const parent = input.reply_to ? await getMessage(env.DB, input.reply_to) : null;
  if (input.reply_to && !parent) throw badInput(`No stored message ${input.reply_to} to reply to`);

  const own = mailboxes(env);
  const to = input.to === undefined || input.to === null || (Array.isArray(input.to) && input.to.length === 0)
    ? (parent ? addressList(replyRecipients(parent, own), 'to') : [])
    : addressList(input.to, 'to');
  const cc = addressList(input.cc, 'cc').filter((a) => !to.includes(a));
  const bcc = addressList(input.bcc, 'bcc').filter((a) => !to.includes(a) && !cc.includes(a));
  if (to.length === 0) throw badInput('No recipient: give to, or reply_to an email with a sender');
  const recipients = [...to, ...cc, ...bcc];
  if (recipients.length > MAX_RECIPIENTS) throw badInput(`More than ${MAX_RECIPIENTS} recipients`);

  const given = input.subject?.trim() ? input.subject : null;
  const subject = parent ? replySubject(given ?? parent.subject) : given;
  if (!subject) throw badInput('A new email needs a subject');

  // The lookups don't depend on each other; the refusals below go in order.
  const { day, month } = periods();
  const [earlier, later, blocked, written, today, thisMonth] = await Promise.all([
    findSendByKey(env.DB, key),
    parent ? laterInThread(env.DB, parent.thread_id, parent.seq) : null,
    suppressed(env.DB, unique(recipients.map(canonicalAddress))),
    parent ? true : hasWritten(env.DB, recipients),
    sendCounts(env.DB, day),
    sendCounts(env.DB, month),
  ]);

  // A retry after a timeout must not send twice.
  if (earlier) throw duplicate(key, earlier);

  // A reply answers the latest word: not an email they have written again since.
  if (later) {
    throw new MailError(409, 'STALE', `${later.from_addr} wrote again at ${later.created_at} (${later.id}), after the email this answers: read that first, and reply to it if the reply still stands`, {
      id: later.id, mailbox: later.mailbox,
    });
  }

  if (blocked.length) {
    throw new MailError(409, 'SUPPRESSED', `Suppressed: ${blocked.map((b) => `${b.address} (${b.reason})`).join(', ')}`, {
      addresses: blocked.map((b) => b.address),
    });
  }

  // Caps count every send through the Worker: the project's desks share a sending domain.
  const firstTouch = !written;
  const checks = [
    ['daily', today.sends],
    ['monthly', thisMonth.sends],
    ...(firstTouch ? [['first_touch_daily', today.firstTouches]] : []),
  ];
  for (const [name, used] of checks) {
    const limit = cap(env, CAPS[name]);
    if (used >= limit) {
      throw new MailError(429, 'CAP', `The ${name.replaceAll('_', ' ')} cap is reached: ${used} of ${limit} (${CAPS[name]})`, {
        cap: name, setting: CAPS[name], used, limit,
      });
    }
  }

  if (input.check) return { ok: true, check: true, first_touch: firstTouch, subject };

  const id = crypto.randomUUID();
  const threading = replyHeaders(parent);
  try {
    await insertOutbound(env.DB, {
      id,
      direction: 'out',
      mailbox: from,
      thread_id: parent?.thread_id ?? id,
      message_id: null,
      in_reply_to: threading.inReplyTo,
      refs: threading.refs.length ? threading.refs.join(' ') : null,
      from_addr: from,
      from_name: sendable[from] || null,
      to_addrs: to.join(','),
      cc_addrs: cc.join(',') || null,
      bcc_addrs: bcc.join(',') || null,
      subject,
      text: input.text,
      html: input.html ?? null,
      status: 'sending',
      key,
      first_touch: firstTouch ? 1 : 0,
    });
  } catch (error) {
    if (!isKeyConflict(error)) throw error;
    throw duplicate(key, await findSendByKey(env.DB, key));
  }

  const name = sendable[from];
  let result;
  try {
    result = await env.EMAIL.send({
      from: name ? { email: from, name } : from,
      to,
      ...(cc.length ? { cc } : {}),
      ...(bcc.length ? { bcc } : {}),
      replyTo: from,
      subject,
      text: input.text,
      ...(input.html ? { html: input.html } : {}),
      headers: { 'X-Desk-Mail-Id': id, ...threading.headers },
    });
  } catch (error) {
    const code = error?.code ?? 'SEND_FAILED';
    const words = error?.message ?? String(error);
    await markFailed(env.DB, id, `${code}: ${words}`);
    console.error(JSON.stringify({ event: 'email.send_failed', id, code }));
    if (code === 'E_RECIPIENT_SUPPRESSED') {
      // Put the refused recipient on the list: the only one, or the ones the error names.
      const named = recipients.length === 1 ? recipients : recipients.filter((r) => words.toLowerCase().includes(r));
      for (const address of named) await suppress(env.DB, canonicalAddress(address), 'suppressed by Email Sending');
    }
    throw new MailError(502, 'SEND_FAILED', `Email Sending refused it: ${words}`, { id, provider_code: code });
  }

  // Sent. If recording that fails, the row stays 'sending' and keeps its key, so a retry
  // is refused as a duplicate rather than sent again.
  const messageId = String(result?.messageId ?? '').trim().replace(/^<|>$/g, '') || null;
  await markSent(env.DB, id, messageId);
  console.log(JSON.stringify({ event: 'email.sent', id, from }));
  return { id, message_id: messageId, status: 'sent' };
}

function duplicate(key, earlier) {
  return new MailError(409, 'DUPLICATE', `Already ${earlier?.status ?? 'sent'} with key ${key}`, {
    id: earlier?.id ?? null,
    status: earlier?.status ?? null,
    message_id: earlier?.message_id ?? null,
  });
}
