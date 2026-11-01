# PRD 11: briefs, desks hand work to each other

## Goal

One desk can give another a piece of work, and the receiving desk's chat wakes for it. This is
how the GM delegates (PRD 15), and any desk can use it: an SEO desk that finds a partner page
worth chasing briefs the partners desk. The GM runs the business by
delegating to the desks, with trust and spot checks. So a brief is an action, and it goes
through the same path as an email: approved by a person at first, then trusted, with every
fifth shown in full.

## Locked decisions

- A brief is an action with:
  - `channel = 'desk'`;
  - `identity` = the briefing desk's name (`gm`);
  - `target = 'desk:<name>'`, naming another desk in this database;
  - `kind` = `brief`, or a finer kind the briefing desk defines (`brief-outreach`), each of
    which earns trust on its own;
  - `title` = the work in one line, which becomes the task's `what`;
  - `body` = the full brief: the job, why it matters, the keys it may touch, the criteria;
  - `payload` = `{"done_when": "...", "due": "YYYY-MM-DD", "about": "<key>", "owner": "agent"}`.
    `done_when` is required. `due` and `about` are optional. `owner` is `agent` (the default)
    or `builder`.
- `node desks/desk.mjs send <id>` delivers a brief. In one transaction it claims the action
  (the send gate decides, as for email), inserts the task on the target desk with
  `source = 'brief:<id>'` and `created_by` = the sender, and records the action as `sent`, then
  `verified`, with `provider_ref = 'task:<task id>'`. A brief is delivered once or not at all.
  There's no outside provider, so delivery is its own verification and trust is counted then.
- The receiving desk reads the brief from the action its task's `source` names. Tasks get no
  new column. Live desks already write `action:<id>` as a task's source for their own
  follow-ups, so briefs get a prefix of their own, `brief:<id>`.
- A brief never approves anything. If it asks the receiving desk to send emails or change a
  page, those are the receiving desk's own actions, under its own trust and approvals.
- A hold on `desk:<name>` (for every desk, or for the briefing desk) stops briefs to that desk.
  A lock on it by someone else stops them too. Both come from the existing send gate, because
  the target is one of the action's keys.
- When a task that came from a brief closes (`done`, `dropped` or `blocked`), the log records it
  against the brief: the briefing desk, `action_id` = the brief, and the task's result. The
  briefing desk sees it in its next round.
- A view, `briefs`, shows every brief with its target desk, its task's status, result, proof
  and age.
- `status` shows, per desk, briefs open to it and the oldest one's age.

## Acceptance criteria

1. WHEN an approved brief is sent THE system SHALL create exactly one open task on the target
   desk, with `what` = the title, `done_when`, `due`, `about` and `owner` from the payload, and
   `source = 'brief:<id>'`, and SHALL record the action as verified with
   `provider_ref = 'task:<task id>'`.
2. WHEN the same brief is sent twice, or by two workers at once, THE system SHALL leave exactly
   one task, and the second send SHALL say the brief was delivered already.
3. WHEN a brief is waiting, or is an untrusted draft, THE send SHALL refuse it and SHALL create
   no task.
4. WHEN a hold covers `desk:<name>` for every desk or for the briefing desk THE send SHALL
   refuse, and the action SHALL stay as it was.
5. WHEN a task is inserted with `source = 'brief:<n>'` and action n isn't a brief to that desk
   being delivered right now THE database SHALL refuse the insert.
6. WHEN a brief targets a desk that doesn't exist, or the briefing desk itself, or has no
   `done_when` THE database SHALL refuse the action when it's created.
7. WHEN the receiving desk is listening THE watch SHALL wake its chat for the new task once
   (PRD 06 behaviour, now checked end to end with a brief).
8. WHEN the task closes THE log SHALL get one row on the briefing desk about the brief, with
   the task's status and result, and `briefs` SHALL show it.
9. WHEN brief kinds are trusted and allowed THE brief SHALL go out alone (mode auto), and every
   fifth SHALL be stopped for a person as a spot check (existing gate, tested for this channel).
10. WHEN a brief is sent THE task SHALL be created in the same transaction as the claim and the
    record, so a failure part-way leaves neither a task nor a sent brief.

## Tasks

1. **core.sql** (needs nothing): an insert check for `channel = 'desk'` actions (target desk
   exists, isn't the briefing desk, `done_when` present, `owner` is `agent` or `builder`); a
   `BEFORE INSERT ON tasks` check on `source LIKE 'brief:%'`; an `AFTER UPDATE OF status ON
   tasks` trigger that logs a closed brief's task against the brief; the `briefs` view. Every
   guard gets a test that fails without it.
2. **desk.mjs send** (needs 1): a desk-channel branch in `send` that does the claim, the task
   and the record in one multi-statement write, with `--json` output like email's. The email
   path doesn't change.
3. **desk.mjs status** (needs 1): "n briefs open, oldest 2 d" in each desk's line.
4. **Playbook** `kit/playbooks/briefs.md` (needs nothing): writing a brief (the job, why, the
   keys it owns, `done_when`, the check that proves it), receiving one (do it, record the result
   and proof, or drop it with a reason the briefing desk can act on), and that a brief never
   approves an outward action. The desk skill points to it.
5. **Tests** in `test/desk.test.mjs` for criteria 1–6 and 8–10, and one in the watch tests for
   7.

## Implementation Notes

Built as planned, on 2026-11-01:

- `core.sql`: the `brief_faults` view says what's wrong with a brief (target desk exists and
  isn't the briefing desk, `done_when`, `owner`, `due` a date); `brief_written` and
  `brief_edited` refuse on it when a brief is written and whenever its target or payload
  changes, so an approved brief can always be sent. `brief_sent_has_task`, so a brief is
  never `sent` or `verified` without its own task; `task_from_brief` (a `brief:<n>` task
  only while brief n is being sent to that desk, and only once); `task_from_brief_closed`
  logs done, dropped and blocked on the briefing desk; the `briefs` view; indexes on
  `tasks(source)` and on briefs' targets.
- `desk.mjs send` branches to `sendBrief` for channel `desk` before reading mail settings,
  so desks without mail can brief. The claim, task and record are one transaction.
- Found while building: node:sqlite binds every JS number as REAL, so on a local database
  `'brief:' || :id` read `brief:1.0` and the brief was verified with no `provider_ref`.
  Local binding now passes whole numbers as integers, matching hosted. This also fixes
  `-a n=5` reaching local SQL as 5.0.
- Simplify pass: the brief checks moved from insert and send time to write and edit time
  (one view, two triggers), the brief send went into its own `sendBrief`, and `status`
  gives the oldest brief's age the way it gives every other age. The view qualifies its
  columns, because `desks` has a `target` column of its own.
- Tests: 7 brief tests plus the integer binding test; `pnpm test` 93/93. Not run against a
  hosted database: briefs use the existing multi-statement write path.

Open: nothing for this PRD. Agents vs people (who may approve a brief) is PRD 12.
