# PRD 06: the desk's chat hears everything

## Goal

A desk works in its own chat in the Claude Code app, and that chat is woken whenever there's
something for the desk to do, not only when mail arrives. Doug: "our Claude Code desktop
chat should be receiving these". Today `watch` wakes the chat for mail, and wakes it every
25 minutes for nothing. After this, one listening chat per desk also hears tasks that come
due and the desk's own schedule. It stays quiet when there's nothing, and catches up once
after the app was closed.

## Locked decisions

- `watch <desk>` stays the way in, run by the chat as a background command, whose exit wakes
  the chat. No headless runner, no channels (they need the terminal app), no Monitor (it
  expires within 30 minutes).
- A desk's schedule is a header line in `desk.md`: `Round: weekdays 09:00`. Days are
  `daily`, `weekdays`, `weekends` or day names (`mon`, `Mondays`, `mon wed fri`). Times are
  24-hour, one or more (`09:00, 14:30`). The times are the listening machine's local time.
  A desk without the line has no scheduled rounds.
- `watch` wakes for:
  - mail to the desk's `Mail:` addresses, and handovers (as today);
  - an open task or check owned by the agent that is due (the `due` view): once each, while
    it stays due;
  - a scheduled round: once for the latest slot that has passed, however many were missed.
- A desk without a `Mail:` line can listen too, for tasks and rounds; it needs no mail
  settings. A desk with one needs them, as today.
- By default `watch` waits until there's something, with no time limit. `--max` still ends
  a quiet wait, for runners that need it.
- The first time a desk listens is "from now on" for tasks and rounds too: what's already
  due is the round's job, which `listen` does first. After that, anything that came due
  while nobody listened wakes the chat once, when it listens again.
- What has woken the chat is kept in a new core table, `listeners` (one row per desk), so
  restarts never repeat a wake and never miss one. It also records when the listener last
  looked, so `status` can say whether a desk is listening.
- The lines `watch` prints never carry text from outside: `task 12 due 2026-10-30`,
  `check 4 due 2026-10-30`, `round due 2026-10-30 09:00 (weekdays 09:00)`, with
  `, missed 3` when more than one slot passed. `--json` prints the same as objects.

## Acceptance criteria

- WHEN an agent task or check becomes due while a desk listens, THEN `watch` SHALL print one
  line for it and exit 0, and SHALL NOT print it again on the next run while it stays due.
- WHEN a task becomes due again after it stopped being due (it was moved to a later date),
  THEN `watch` SHALL wake for it again.
- WHEN a task belongs to a person or the builder, THEN `watch` SHALL NOT wake for it.
- WHEN a desk listens for the first time, THEN tasks already due and rounds already past
  SHALL NOT wake it.
- WHEN a scheduled slot passes while a desk listens, THEN `watch` SHALL print one round line
  and exit 0. WHEN several slots passed while nobody listened, THEN the next `watch` SHALL
  print one round line for the latest, with how many were missed.
- WHEN the `Round:` line changes, THEN the new schedule SHALL apply from now, with no wake
  for slots under it that already passed.
- WHEN `Round:` can't be read, THEN `watch` and `doctor` SHALL say what's wrong and show a
  line that works.
- WHEN a desk has no `Mail:` line, THEN `watch` SHALL listen for tasks and rounds without
  mail settings, and say so in its first line.
- WHEN nothing happens, THEN `watch` SHALL keep waiting without printing, unless `--max`
  was given.
- WHEN someone runs `status`, THEN the line of each desk that has listened SHALL say whether
  it's listening: who, and when the listener last looked; or when it last listened. (Desks
  that never listened say nothing about it, to keep the line short.)
- WHEN someone else takes the desk over, the lock is let go, or a newer `watch` for the desk
  starts, THEN a running `watch` SHALL stop with exit 2 at its next look, without printing a
  wake, so one desk never wakes two chats.
- The desk skill's Listening section SHALL cover the new lines: a task or check is done as
  the round's step for it, a round line runs a round, and then listening starts again.

## Tasks

1. `listeners` table in `core.sql`, with a test that init is safe to repeat.
2. `Round:` parsing and the latest-slot sum, with `doctor` checking the line.
3. `watch`: tasks, checks and rounds; mail optional; no default limit; the new lines.
4. `status`: listening per desk.
5. The desk skill, `anatomy.md`, `new-desk`, `DECISIONS.md` ("How listening works") and the
   changelog.
6. Tests for each criterion; `pnpm test` and `pnpm e2e`.

## Implementation Notes

Built on 30 Oct, in the session that ran the live demo.

- `core.sql` gains the `listeners` table (`woken_for`, `round`, `round_at`, `checked_at`) and a
  `listening` view (who holds `listen:<desk>`, and the latest `checked_at` of `listeners` and
  `mail_cursors`). Handovers moved from `mail_cursors.handed_over` into `woken_for` as
  `inbox:<id>`; the old column stays, unused, because core tables are never edited.
- `watch` keeps one set of refs: every look saves the handovers and due items open right now,
  with the mail cursor and the latest round slot, in one transaction, before printing, and
  prints what it saved. Tasks and checks are keyed with their date (`task:12@2026-10-30`), so
  one moved later and due again wakes again even if nobody looked in between. The first listen
  seeds the set with what's already due, and `round_at` with the latest slot already past. An
  existing `mail_cursors` row with no `listeners` row (a desk that listened before this) keeps
  the handovers in `handed_over` and counts as a first listen for tasks and rounds.
- Each run of `watch` writes a random `run` id to its `listeners` row at start, in the same
  transaction that reads the cursor. Every look saves only while the row still has its run
  and its user holds `listen:<desk>`; otherwise it stops with exit 2. That ends the stale
  listener a lost 25-minute limit used to end, and the second watcher a chat may start.
- `listeners.own` records the addresses handovers were worked out against: a changed `Mail:`
  line makes open mail count from now. A desk without `Mail:` has no handovers at all.
- Due dates are printed through `oneWord`, so a stray value can't make a line of its own. An
  empty header line (`Round:`) no longer takes the next line as its value.
- `parseRound` takes `daily`, `every day`, `weekdays`, `weekends`, day names of three letters
  or more with an optional plural (`mon`, `tues`, `Thursdays`), and `HH:MM` or `H.MM` times,
  skipping `at`, `and`, `on`. No days means every day. `roundsDue` walks local calendar days
  back from now (at most 366), so DST shifts are the machine's own.
- Events print in the order mail, handover, task/check (by due date, tasks first), round. A
  task with no due date prints `due now`.
- `--max` has no default; the quiet line is `nothing new for <desk> in <t>` (`{"event":"quiet"}`
  with `--json`). The lock's `doing` is now `listening`.
- `status` adds one bit per desk line: `listening (doug, looked 30s ago)` while the listener
  looked in the last 15 minutes, `doug holds listening, last looked 2 h ago` after that (a
  woken chat at work, or a closed app), `last listened 3 days ago` once the lock is gone.
  `--json` has `listening`. `ago()` now says hours and days for long gaps.
- `doctor` reports an unreadable `Round:` line.
- A fresh-eyes review before commit found the stale and double listeners, re-due without a
  look, the upgrade and `Mail:` change cases, due text and the empty header line; each has a
  test now, and the takeover and re-due tests fail without their fix.
- Tests: tasks and checks once each, re-due, person and builder tasks ignored, from now on;
  rounds once, missed count, init keeps state, a changed line counts from now, a bad line in
  `watch` and `doctor`; `parseRound` and `roundsDue` on fixed dates; takeovers; handovers
  across `Mail:` changes and the upgrade; a desk without mail; status. `pnpm test` and
  `pnpm e2e` pass. Not run against a hosted database: the change adds queries but not a new
  way for SQL to reach the database.

Open:

- The `due` view counts dates in UTC, and rounds in the machine's local time.
- A chat that is woken and works for over 15 minutes shows as "holds listening" in status
  until it listens again; so does a listener run with `--every` over 15 minutes.
- `parseRound` turns down ranges (`mon-fri`, `Mon to Fri`), time zones and `9am`; the error
  shows a line that works.
