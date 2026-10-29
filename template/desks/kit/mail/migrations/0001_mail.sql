-- The desks' mailbox: every email in and out, and the never-contact list.
-- Applied by `wrangler d1 migrations apply <database> --remote` from desks/mail/.
-- Never edit a migration that's been applied: add the next one instead.

-- Every email in and out.
--   Inbound (direction 'in'): status 'received'.
--   Outbound (direction 'out'): status 'sending' while Email Sending has it, then 'sent'
--   or 'failed'. A send that was refused before it reached Email Sending isn't stored.
CREATE TABLE messages (
  id TEXT PRIMARY KEY,
  -- Orders the changes feed. Set inside the insert statement as
  -- (SELECT coalesce(max(seq), 0) + 1 FROM messages), so it follows commit order.
  -- Timestamps can't: two receives can commit out of order.
  seq INTEGER NOT NULL UNIQUE,
  direction TEXT NOT NULL CHECK (direction IN ('in', 'out')),
  -- Inbound: the address it was delivered to (the envelope recipient, one of MAILBOXES).
  -- Outbound: the address it was sent as (one of SENDERS).
  mailbox TEXT NOT NULL,
  -- The conversation. A message that starts one has thread_id = id.
  thread_id TEXT NOT NULL,
  -- RFC 5322 Message-ID without angle brackets. Outbound: the one Email Sending returned.
  message_id TEXT,
  in_reply_to TEXT,
  -- Space-separated Message-IDs, oldest first, without angle brackets.
  refs TEXT,
  -- Lower-case address.
  from_addr TEXT NOT NULL,
  from_name TEXT,
  -- Comma-separated lower-case addresses.
  to_addrs TEXT NOT NULL,
  cc_addrs TEXT,
  -- Outbound only.
  bcc_addrs TEXT,
  subject TEXT NOT NULL DEFAULT '',
  -- Inbound text and HTML are cut at 200,000 and 500,000 characters (D1 rows are capped
  -- at 2 MB). The forwarded copy has the whole email.
  text TEXT,
  html TEXT,
  -- JSON [{ filename, type, size }]. The files aren't kept: the forwarded copy has them.
  attachments TEXT,
  -- JSON of the inbound headers worth judging a message by (auto-submitted, list-id,
  -- precedence, authentication-results and the like).
  headers TEXT,
  status TEXT NOT NULL CHECK (status IN ('received', 'sending', 'sent', 'failed')),
  error TEXT,
  -- Outbound only: the desk's action key. One key is sent at most once (see below).
  key TEXT,
  -- Outbound only: 1 for a new email, not a reply, to addresses that have never written
  -- to any of the mailboxes.
  first_touch INTEGER NOT NULL DEFAULT 0 CHECK (first_touch IN (0, 1)),
  -- Inbound only: 1 for mail no person wrote (out-of-office, bounces, mailing lists).
  auto INTEGER NOT NULL DEFAULT 0 CHECK (auto IN (0, 1)),
  -- Inbound only: 1 for our own copy of a send that didn't go through the Worker (an
  -- alias send BCC'd to the desk). Its From is one of SENDERS. Left out of the changes
  -- feed.
  own INTEGER NOT NULL DEFAULT 0 CHECK (own IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  sent_at TEXT
);

-- A key that's sending or sent can't be used again, so a retry after a timeout can't send
-- twice. A failed send doesn't hold its key.
CREATE UNIQUE INDEX messages_key_once ON messages (key)
  WHERE key IS NOT NULL AND status IN ('sending', 'sent');
CREATE INDEX messages_key ON messages (key);
CREATE INDEX messages_mailbox_seq ON messages (mailbox, seq);
CREATE INDEX messages_thread ON messages (thread_id, seq);
CREATE INDEX messages_message_id ON messages (message_id);
CREATE INDEX messages_direction_status ON messages (direction, status, created_at);
CREATE INDEX messages_from ON messages (from_addr, direction);

-- Addresses never written to again: opt-outs, bounces, anyone the person says no to.
-- Stored lower-case without a +tag, so jo+news@acme.com is covered by jo@acme.com.
CREATE TABLE suppressions (
  address TEXT PRIMARY KEY,
  reason TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
