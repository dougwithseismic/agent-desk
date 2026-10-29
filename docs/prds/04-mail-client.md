# PRD 04: `desk.mjs mail` and `desk.mjs send <id>`

## Goal

Every desk reads and sends mail the same way, through the one script, and a send is exactly
the stored, approved version, with the result recorded in the same step. This replaces each
project's own mail command and the copying of bodies into files.

## Locked decisions

- `node desks/desk.mjs mail <command>` speaks the kit Worker's API with `DESK_MAIL_URL` and
  `DESK_MAIL_TOKEN`: `inbox [--mailbox a] [--limit n]`, `read <id>`, `thread <id>`,
  `search <text>`, `sent [--limit n]`, `status`, `suppress <address> "<reason>"`,
  `suppressions`. `--json` prints the Worker's JSON.
- `node desks/desk.mjs send <action id>` sends an action whose channel is `email`:
  1. claims it in the database (`approved` → `sending` as `human`, or a trusted `draft` →
     `sending` as `auto`); the database's guards decide, and a refusal stops it;
  2. sends the stored title and body, `target` and `payload.cc`/`bcc`, from the action's
     identity, with `payload.reply_to` for a reply and the action's key as the send key;
  3. records the answer at once: `sent` with `provider_ref = mail:<id>`; `failed` with the
     Worker's words for a refusal; `uncertain` for a timeout or anything unreadable.
- It never retries. An `uncertain` send is settled by `mail sent --key <key>`.

## Acceptance criteria

- WHEN `send <id>` runs on an approved email action, the system SHALL send exactly its stored
  text and record `sent` with the provider ref.
- WHEN the database refuses the claim (not approved, held, locked by someone else, spot check
  due), the system SHALL send nothing and print the refusal.
- WHEN the Worker refuses, the system SHALL record `failed` with its words.
- WHEN the Worker times out or answers something unreadable, the system SHALL record
  `uncertain`, and a second `send <id>` SHALL refuse to send it.

## Implementation Notes

- Built inline by the lead. `desk.mjs` gained `mail` (inbox, read, thread, search, sent,
  status, suppressions, suppress) and `send <action id>`, on two shared helpers: `mailFetch`
  (no redirects followed, timeouts, the network error kept apart) and `mailCall` (401/403,
  a redirect names the address to use, a refusal keeps the Worker's words, 5xx and non-JSON
  answers are retryable). `watch` and `doctor` use the same helpers.
- The Worker gained a check mode: `POST /v1/send` with `check: true` runs every refusal
  (sender, addresses, key, suppressions, caps, first touch) and stores and sends nothing,
  and answers the subject it would send. `send` asks it right before the claim, so a
  refusal leaves the action as it was instead of failing it, and stops if the subject
  isn't the title (the Worker makes a reply's subject start `Re:`). This replaced a first
  version that copied the Worker's rules into `desk.mjs` and got first touch wrong.
- The Worker also refuses a reply to an email the sender has written again since (409
  `STALE`, automatic replies don't count), on the check and on the real send, so mail that
  lands between the two still stops it. `GET /v1/threads/<id>` takes the id of an email
  in the thread too, so the recorded `mail:<id>` opens the thread.
- The send key is the action's key, as decided: `actions.key` is already unique across
  desks, so a `<desk>:` prefix was dropped.
- `send` also stops before the claim for: an identity outside the desk's `Mail:` line, a
  desk with no folder here, a target that isn't `email:`, a payload field other than `cc`,
  `bcc`, `reply_to` and `thread` (files, html), a `reply_to` that isn't an email id, and a
  Worker that doesn't answer the check as a check.
- Recording: up to three tries a second apart when the database didn't answer; otherwise,
  or after that, `send` prints the exact `sql` to run. A retry that finds the row already recorded the same way
  accepts it (a hosted database can take a write and lose the answer). A lost claim answer
  says how to settle it.
- `mail` lists only the desk's own addresses: `--desk`, or the only desk with a `Mail:`
  line; with several it asks which. `sent --key` needs no desk, since keys are unique.
  `read` and `thread` take any id, so a desk can open mail handed over to it. Output strips
  control characters from every field.
- Tests: `test/desk.test.mjs` runs `send` and `mail` against an in-memory Worker (7 tests:
  the exact email sent once, every claim refusal, every pre-claim stop, refusals recorded
  as failed including 502 SEND_FAILED, five uncertain answers never resent, the record not
  taken or changed mid-send, and the mail commands). `test/mail.test.mjs` adds the check
  mode, `STALE` and threads by email id. Fifteen mutations of the new rules each failed a
  test. `pnpm test`: 74 pass.
- A code review found 14 issues; all were fixed before merging. A cleanup pass moved the
  newer-reply check into the Worker and shared one refusal rule, one query helper and one
  desk lookup between `watch`, `mail` and `send`.
- Checked by hand with `wrangler dev` (4.156.0) in a scratch project: mail in through the
  local email handler, `watch` woke with its inbox id, `send` replied once and a second
  `send` refused, `mail thread` showed both. The installed wrangler 4.82 can't run the
  example's compatibility date (2026-10-01), so the recipe should say `npx wrangler@latest`
  (PRD 05).
- Open: the same person listening to one desk from two sessions both wake (the listen lock
  compares people, not sessions); forged own-address mail needs DMARC `p=reject` (PRD 03).
- Open, from the cleanup review: a desk's addresses could live in the database (a table
  `init` fills from the `Mail:` lines) so a trigger refuses an email action from another
  desk's address when it's prepared, not when it's sent; and a Worker refusal after the
  claim is final (`failed`), where a guarded `sending > approved` move would let the same
  action try again.
