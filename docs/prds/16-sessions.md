# PRD 16: the GM starts desks' sessions, and watches for stalled work

## Goal

A desk only works while a chat listens to it, and today only the person opens those chats. When
a desk has work and nobody is listening, it sits. One central skill
should delegate and start Claude Code sessions without a yes box each time. In the Claude Code app,
scheduled tasks are the one way a session can start another without a click, so the GM uses
them.

Starting a desk is one answer to stalled work. The other is noticing it: a desk whose
listener went quiet, a brief past its due, an action stuck sending, audits left undone, a
headline nobody measured. Nothing looks for those unless a person does.

## Locked decisions

- **The watchdog** is a core view, `watchdog`, one row per problem with the desk, what's wrong
  in words, since when, and what fixes it:
  - due agent work, an open brief or a round due, and nobody listening for 15 minutes;
  - a brief open past its `due`, or 7 days with none;
  - an action `sending` for more than 15 minutes, or `uncertain` for more than an hour;
  - `audit_due` rows older than 7 days;
  - a desk's headline not measured for 7 days, or a check past its date.
  The GM's round reads it first, does what it may (start the desk, brief again, audit), and
  puts the rest in the person's brief. `status` shows it for every desk. Until scheduled tasks
  are allowed, `status` and the person's brief are where it's seen.

- **What the app allows** (checked 1 Nov): `start_session` shows the person a card unless they
  asked in words, and it's refused on turns started by another session or an automated event.
  Raising a session's permission mode always asks. A scheduled task saved in auto or bypass mode
  runs without asking, and `run_scheduled_task` starts it now as a new session in its folder,
  with its stored prompt and mode. Subagents run in their parent's mode.
- **One on-demand task per desk**, made once at setup with the person's yes: no schedule, the
  project's folder, the prompt `/desk <name> listen`, and a description saying the GM starts it
  when the desk has work and nobody is listening. The desk records it in a header line:
  `Start: scheduled-task <task id>`.
- **The GM's own day** is a recurring task on the person's schedule that runs `/desk gm listen`.
  When a GM chat is already listening, the new one sees it in `status` and stops.
- **When the GM starts a desk:** the desk has due agent work, an open brief or a round due; the
  `listening` view shows nobody for 15 minutes; and the GM hasn't started that desk in the last
  hour. Each start is logged (`note`, about `desk:<name>`, with the task id). A refused start
  (already running, disabled) goes in the person's brief.
- **Builders for initiatives** start the same way: one on-demand task per project whose prompt
  takes the oldest open builder task on the GM desk. The task row is the builder's brief.
- **Permissions.** The playbook explains the modes in plain words and recommends auto mode for
  desk tasks; bypass if the person wants no prompts at all. Either way the database guards and
  the restricted keys are the line (DECISIONS, "Bypass mode moves the guard into the
  database").
- **Elsewhere** (Codex, or no app), the GM can't start sessions. It puts "open the partners
  desk: `/desk partners listen`" in the person's brief instead.
- `status` shows each desk's `Start:` line, and flags a desk with work and nobody listening.

## Acceptance criteria

1. WHEN a desk has due agent work and nobody has listened for 15 minutes THE GM's round SHALL
   start the desk's task once and log it.
2. WHEN the GM started that desk less than an hour ago THE GM SHALL NOT start it again, and
   SHALL put it in the person's brief if it's still not listening.
3. WHEN a desk has no `Start:` line THE GM SHALL ask the person to open it, in the brief.
4. WHEN the GM's scheduled run finds a GM chat already listening THE new run SHALL stop
   without taking over.
5. WHEN `status` runs THE output SHALL show which desks have work and nobody listening.
6. WHEN a brief passes its due, an action stays `sending` past 15 minutes, or audits wait past
   7 days THE `watchdog` view SHALL list each with its desk and what fixes it, and `status`
   SHALL show them; WHEN the problem is fixed THE row SHALL go.

## Tasks

1. `core.sql`: the `watchdog` view, with a test per row type. `desk.mjs`: read `Start:`;
   `status` shows the watchdog.
2. `kit/types/gm/playbooks/sessions.md`: setting up the tasks with the person, the start rule,
   permissions.
3. `new-desk`: offer the tasks during GM setup, after the person's yes.
4. Try it live in one project, with the person's yes. Record what the app does in the notes.

## Implementation Notes

Built 1 Nov 2026 in the kit: tasks 1 to 3. Task 4, trying it live in a project, waits for the
person's yes to create scheduled tasks there.

- **`unheard`** (core view): desks nobody is listening to, meaning no `listen:` lock, or a listener
  that hasn't looked for 15 minutes (the same rule `status` already used). Its `fix` says to start
  the desk, or, when a log note about `desk:<name>` with ref `scheduled-task:<id>` is less than
  an hour old, to ask the person instead (AC 2).
- **`watchdog`** (core view): one row per problem, with `desk`, `problem`, `about`, `what`, `since`
  and `fix`. A row goes away once its problem is fixed. The rows:
  - `nobody listening`: due work owned by the agent (what `watch` wakes for), on an unheard desk;
  - `brief overdue`: an open brief past its `due`, or open over 7 days with no due date;
  - `stuck sending` after 15 minutes and `uncertain` after an hour, both timed from `updated_at`;
  - `audit overdue`: `audit_due` rows sent more than 7 days ago;
  - `headline stale`: not measured for 7 days, or never measured on a desk older than that;
  - `check overdue`: past its `check_at`. On the day itself it's due, not late.
- **Rounds.** SQL can't read `Round:` lines, so `status` works out each desk's latest scheduled
  round and adds a `nobody listening` row when it came after the desk was last looked at (or after
  the desk was made). It skips desks that already have a row for due work.
- **`Start: scheduled-task <task id>`** in `desk.md`. `desksOnDisk` reads it, and init stops on
  anything else. `status` shows it on the desk's line, and `--json` adds `start` to each board row.
- **`status`** gets a "Stalled" section and a `watchdog` key in `--json`.
- **Playbooks**:
  - `kit/types/gm/playbooks/sessions.md` covers setting up the tasks with the person
    (`create_scheduled_task` with no schedule makes an on-demand task), the permission modes in
    plain words, the start rule with its log note, refused starts, and what happens without the app.
  - The round reads the watchdog first, and the person's brief gains "Started" and "Stuck" lines.
  - The desk skill now stops a listen when another chat looked in the last 15 minutes (AC 4).
  - `new-desk` offers the tasks during GM setup.
- **Tests**:
  - one per row type, each checking the row goes once fixed;
  - the 15-minute rule, and the start-in-the-last-hour fix (run from `sessions.md`'s own SQL);
  - `status` with a missed round and a `Start:` line;
  - the `Start:` fault.

  18 one-change mutations, all caught.
- **Open:**
  - Not tried live (task 4). Two things to record then: what `run_scheduled_task` does when the
    app is busy, and whether an auto-mode task stalls on its first tool approval.
  - A listening chat busy for more than 15 minutes on a long round doesn't update its listener,
    so it reads as nobody listening. A start then is refused if the task is already running,
    and the new session stops when it sees the listener in `status`. It still costs a session,
    though. A heartbeat from the chat during long work would fix it.
  - Rounds are worked out on the machine running `status`, using its clock. On a shared database
    with people in different time zones, that can differ from the listener's clock.
  - `audit overdue` only covers `audit_due`'s 14 days, so after that an unaudited send leaves the
    watchdog.
  - Hosted libSQL tests not run (no test database here).
