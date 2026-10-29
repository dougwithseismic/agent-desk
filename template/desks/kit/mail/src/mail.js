// Pure helpers: settings, addresses, Message-IDs and threading, automatic mail, and the
// fresh text of a reply. No IO.

/** A refusal the API answers with its status, code and words. */
export class MailError extends Error {
  constructor(status, code, message, extra = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}

export const badInput = (message, extra) => new MailError(400, 'BAD_INPUT', message, extra);

// Settings. They're JSON vars in desks/mail/wrangler.jsonc, which reach the Worker as
// values. In .dev.vars or the dashboard they're strings, so a string is parsed too.

const settingError = (name, wanted) =>
  new MailError(500, 'SETTINGS', `${name} must be ${wanted} (vars in desks/mail/wrangler.jsonc)`);

function setting(env, name) {
  const value = env?.[name];
  if (typeof value !== 'string') return value ?? undefined;
  const s = value.trim();
  if (!s) return undefined;
  if (!/^[[{"\d-]/.test(s)) return s;
  try {
    return JSON.parse(s);
  } catch {
    throw settingError(name, 'valid JSON');
  }
}

function addressSetting(env, name, normalise, { required = false } = {}) {
  let value = setting(env, name) ?? [];
  if (typeof value === 'string') value = value.split(',');
  if (!Array.isArray(value) || value.some((v) => typeof v !== 'string')) {
    throw settingError(name, 'a JSON array of addresses');
  }
  const out = unique(value.map(normalise).filter(Boolean));
  const bad = out.filter((a) => !isEmail(a));
  if (bad.length) throw settingError(name, `a list of addresses (not ${bad.join(', ')})`);
  if (required && out.length === 0) throw settingError(name, 'at least one address');
  return out;
}

/** Every address the Worker receives for, lower-case without a +tag. */
export const mailboxes = (env) => addressSetting(env, 'MAILBOXES', canonicalAddress, { required: true });

/** Verified Email Routing destinations that get a copy of every stored email. */
export const forwardTo = (env) => addressSetting(env, 'FORWARD_TO', normalAddress);

/** The addresses the Worker may send as, with their display names: { address: name }. */
export function senders(env) {
  let value = setting(env, 'SENDERS') ?? {};
  if (typeof value === 'string') value = value.split(',');
  if (Array.isArray(value)) value = Object.fromEntries(value.map((a) => [a, '']));
  if (!value || typeof value !== 'object') {
    throw settingError('SENDERS', 'a JSON object of { "address": "Display name" }');
  }
  const out = {};
  for (const [key, name] of Object.entries(value)) {
    const address = normalAddress(key);
    if (!isEmail(address)) throw settingError('SENDERS', `keyed by address (not ${key})`);
    if (name !== null && name !== undefined && typeof name !== 'string') {
      throw settingError('SENDERS', `a display name string for ${address}`);
    }
    out[address] = (name ?? '').trim();
  }
  return out;
}

/** A sending cap. Missing or invalid stops sending rather than sending without one. */
export function cap(env, name) {
  const value = setting(env, name);
  if (!Number.isInteger(value) || value < 0) throw settingError(name, 'a whole number, 0 or more');
  return value;
}

// Addresses

const ADDRESS = /^[^\s@<>(),;:"[\]\\]+@[^\s@<>(),;:"[\]\\]+\.[^\s@<>(),;:"[\]\\]+$/;

/** A bare address (no display name), up to 254 characters. */
export const isEmail = (value) => typeof value === 'string' && value.length <= 254 && ADDRESS.test(value);

/** Trimmed and lower-case. How addresses are stored. */
export const normalAddress = (address) => String(address ?? '').trim().toLowerCase();

/**
 * Lower-case with any +tag dropped from the local part. How addresses are compared for
 * mailboxes, senders and suppressions: jo+news@acme.com is jo@acme.com.
 */
export function canonicalAddress(address) {
  const lower = normalAddress(address);
  const at = lower.lastIndexOf('@');
  if (at < 1) return lower;
  return `${lower.slice(0, at).split('+')[0]}@${lower.slice(at + 1)}`;
}

export const unique = (values) => [...new Set(values)];

/** Comma-separated stored addresses as a list. */
export const addressesOf = (value) => (value ? value.split(',').filter(Boolean) : []);

// Message-IDs and threading

/** Message-IDs without angle brackets, in order, from an In-Reply-To or References value. */
export function messageIds(value) {
  if (!value) return [];
  const bracketed = [...String(value).matchAll(/<([^<>\s]+)>/g)].map((m) => m[1]);
  if (bracketed.length) return bracketed;
  return String(value).split(/[\s,]+/).filter(Boolean);
}

export const stripBrackets = (id) => String(id).trim().replace(/^<|>$/g, '');

// Re:, Fwd: and their equivalents in other languages, with an optional [n] count.
const PREFIXES = /^\s*((re|fw|fwd|aw|wg|odp|vs|sv|tr|enc|antw|doorst|rv|res|ynt|vb)\s*(\[\d+\])?\s*:\s*)+/i;
const REPLY_PREFIXES = /^\s*((re|aw|odp|vs|sv|antw|res|ynt)\s*(\[\d+\])?\s*:\s*)+/i;

/** The subject without reply and forward prefixes or extra spaces, lower-case. */
export const threadSubject = (subject) =>
  String(subject ?? '').replace(PREFIXES, '').replace(/\s+/g, ' ').trim().toLowerCase();

export const sameSubject = (a, b) => threadSubject(a) !== '' && threadSubject(a) === threadSubject(b);

/** A reply's subject: "Re: " once, whatever reply prefixes it had. */
export function replySubject(subject) {
  const base = String(subject ?? '').replace(REPLY_PREFIXES, '').trim();
  return base ? `Re: ${base}` : 'Re:';
}

/** In-Reply-To and References for a reply to a stored message (RFC 5322 section 3.6.4). */
export function replyHeaders(parent) {
  if (!parent?.message_id) return { inReplyTo: null, refs: [], headers: {} };
  const refs = unique([...messageIds(parent.refs), parent.message_id]);
  // A header value is capped at 2,048 bytes: keep the first id and the most recent ones.
  let kept = refs;
  while (kept.length > 2 && kept.map((r) => `<${r}>`).join(' ').length > 1900) {
    kept = [kept[0], ...kept.slice(2)];
  }
  return {
    inReplyTo: parent.message_id,
    refs: kept,
    headers: {
      'In-Reply-To': `<${parent.message_id}>`,
      References: kept.map((r) => `<${r}>`).join(' '),
    },
  };
}

// Automatic mail

const AUTO_SUBJECT =
  /^(automatic reply|auto(matic)?[- ]?reply|auto(matic)? response|out of (the )?office|abwesenheit|automatische antwort|réponse automatique|respuesta automática|automatická odpověď|nepřítomnost|mimo kancelář|автовідповідь|undeliverable|undelivered mail|delivery status notification|delivery failure|mail delivery failed|returned mail|failure notice|nedoručitelné)/i;

/**
 * True for mail no person wrote: out-of-office replies, bounces, mailing lists, no-reply
 * senders. `headers` is a Map of lower-case header names to values.
 */
export function isAutomatic(headers, from, subject) {
  const autoSubmitted = headers.get('auto-submitted');
  if (autoSubmitted && autoSubmitted.trim().toLowerCase() !== 'no') return true;
  if (headers.has('x-autoreply') || headers.has('x-autorespond')) return true;
  if (headers.has('x-ms-exchange-inbox-rules-loop')) return true;
  const precedence = headers.get('precedence')?.trim().toLowerCase();
  if (['auto_reply', 'bulk', 'junk', 'list'].includes(precedence)) return true;
  if (headers.has('list-id') || headers.has('list-unsubscribe')) return true;
  if (/^(mailer-daemon|postmaster|no-?reply|do-?not-?reply)([+.-][^@]*)?@/i.test(from)) return true;
  if (/multipart\/report/i.test(headers.get('content-type') ?? '')) return true;
  return AUTO_SUBJECT.test(String(subject ?? '').trim());
}

// Text

/** The first `max` characters of a text, on one line. */
export function snippet(text, max = 160) {
  if (!text) return '';
  const line = text.replace(/\s+/g, ' ').trim();
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

const WROTE =
  /^(On|Am|Dne|Le|El|Il|Op|Em|W dniu|Den|Pe) .{4,300}(wrote|schrieb|napsal|napsala|a écrit|escribió|ha scritto|schreef|escreveu|napisał|napisała|skrev|написав|написала):\s*$/i;

/**
 * The text without its quoted history: everything from the first quoted line, "On ...
 * wrote:" (even when wrapped over three lines), original-message marker or Outlook
 * header block.
 */
export function freshText(text) {
  if (typeof text !== 'string') return null;
  const lines = text.split(/\r?\n/);
  let end = lines.length;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const wrote = [1, 2, 3].some((n) => WROTE.test(lines.slice(i, i + n).join(' ')));
    const outlook = /^\s*\*?From:\*? .+/.test(line) && /^\s*\*?(Sent|Date):\*? /.test(lines[i + 1] ?? '');
    if (
      /^\s*>/.test(line) ||
      wrote ||
      outlook ||
      /^-{2,}\s*(Original Message|Forwarded message|Původní zpráva|Ursprüngliche Nachricht)/i.test(line) ||
      /^_{8,}\s*$/.test(line)
    ) {
      end = i;
      break;
    }
  }
  return lines.slice(0, end).join('\n').trimEnd();
}
