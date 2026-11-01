# PRD 16: the GM starts desks' sessions

## Goal

A desk only works while a chat listens to it, and today only the person opens those chats. When
a desk has work and nobody is listening, it sits. One central skill
should delegate and start Claude Code sessions without a yes box each time. In the Claude Code app,
scheduled tasks are the one way a session can start another without a click, so the GM uses
them.

## Locked decisions

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

## Tasks

1. `desk.mjs`: read `Start:`; `status` flags; a view of desks with work and no listener.
2. `kit/types/gm/playbooks/sessions.md`: setting up the tasks with the person, the start rule,
   permissions.
3. `new-desk`: offer the tasks during GM setup, after the person's yes.
4. Try it live in one project, with the person's yes. Record what the app does in the notes.

## Implementation Notes

(Filled in after it ships.)
