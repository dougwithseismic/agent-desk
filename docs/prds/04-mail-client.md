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

(Filled in after shipping.)
