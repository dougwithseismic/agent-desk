# Starting desks: sessions, and work that stalls

A desk only works while a chat listens to it. When a desk has work and nobody is listening,
the watchdog says so, and the GM starts the desk. In the Claude Code app, a scheduled task is
the one way a session can start another without a click, so each desk gets one.

## Setting up, once, with the person

Ask first, in plain words: "Each desk gets a task in the app that I can start when it has work
and nobody is listening. Shall I make them?" Make nothing without their yes. Then, per desk:

- **An on-demand task**: no schedule, this project's folder, the prompt
  `/desk <name> listen`, and a description that says the GM starts it when the desk has work
  and nobody is listening. With the app's tools: `create_scheduled_task` with no
  `cronExpression` and no `fireAt`. Task ids are shared by every project on the machine, so
  name the project too: `acme-partners-desk`. If the app refuses the id and offers the same
  one with `-2` on the end, an old folder has the name: clear it ("Making a task again",
  below) and use the plain id.
- **The desk's `Start:` line**: `Start: scheduled-task <task id>` in its `desk.md` header,
  then `init`, which checks it. `status` reads the line from the `desk.md` in the folder it
  runs in, so commit it: a clone or worktree without it shows no `Start:`, and the GM goes back
  to asking the person to open the desk.

And for the GM:

- **Its own day**: a task at the person's time whose prompt is `/desk gm listen`. Don't trust
  the cron to be local time: once it's made, read its `nextRunAt` (UTC) in
  `list_scheduled_tasks` and work out the person's time from it. When we tried it (Nov 2026),
  the app read cron as UTC, so 08:30 in Prague in winter was `30 7 * * 1-5`. Fix the hour with
  `update_scheduled_task`, and write under `## Sessions` in the GM's `desk.md` that the hour
  moves when the clocks change. The app also adds a few minutes to each run.
- **A builder**, if initiatives need building: one on-demand task for the project whose prompt
  takes the oldest open builder task on the gm desk
  (`SELECT * FROM tasks WHERE desk = 'gm' AND owner = 'builder' AND status = 'open' ORDER BY id LIMIT 1`),
  builds it to its `done_when`, and closes it with proof. The task row is the builder's brief.
  Write its id under `## Sessions` in the GM's `desk.md`.

Then check `list_scheduled_tasks` lists every one. A task can sit in
`~/.claude/scheduled-tasks/<id>/` without the app knowing it, and then it can't be started.

Tasks run while the app is open; one due while it was closed runs when it opens. Say so. A run
works in the project's own folder, even when the task was made from a worktree.

## Making a task again

A task the app doesn't list, or one that needs a new id, is made again under the person's
first yes:

1. If the app lists it, delete it (`delete_scheduled_task`). That takes it off the list but
   leaves its folder, `~/.claude/scheduled-tasks/<id>/`.
2. Look in the folder (it should hold only `SKILL.md`), then move it to the Trash. While it's
   there, the id is taken.
3. Every listed task needs its own title. If the old task is still listed, rename it first
   (`update_scheduled_task` with a new `title`) and delete it after.
4. Make it again with the same id, prompt and description, and check it's listed. A session
   the old task started keeps running.

## Permissions

A task runs in the permission mode it was saved in. Explain the modes:

- **Ask** (the default): it stops for a yes on tools, so it waits for someone to click. Not
  much use for a desk that starts on its own.
- **Auto**: it runs without asking for most tools, and the app holds back steps it judges
  risky. The usual choice for desk tasks.
- **Bypass**: no prompts at all. Only if the person wants that.

The app saves a task in auto or bypass mode only when this chat is in that mode, and the tool
result says which mode it got. Either way the database and the restricted keys are the line:
everything that leaves goes through an action, and the guards hold whatever the mode.

## When to start a desk

The watchdog's `nobody listening` rows (`status --json`, `watchdog`): the desk has work for its
agent or a round due, and nobody has listened for 15 minutes. Its `fix` says what to do.

1. **No `Start:` line**: ask the person in their brief: "open the partners desk:
   `/desk partners listen`".
2. **Started in the last hour and still not listening** (the fix says so): don't start it
   again. Put it in the person's brief.
3. **Otherwise**: start it with `run_scheduled_task` and its task id, and log the start in the
   same sitting:

```sql
INSERT INTO log(desk, by, kind, about, summary, ref)
VALUES ('gm', :me, 'note', 'desk:partners', 'started the partners desk: 2 due, nobody listening', 'scheduled-task:partners-desk');
```

A start the app refuses as not found means the app doesn't list the task. Unless the person
took it off on purpose, make it again ("Making a task again") and start it; if you can't tell,
ask in their brief. Any other refused start (the task is disabled, or already running) goes in
the person's brief, with the reason. Start each desk once a round at most.

Elsewhere (Codex, or no app), the GM can't start sessions. Every `nobody listening` row
becomes a line in the person's brief instead.

## The rest of the watchdog

Each row says what fixes it. Do what the GM may (`mandate.md`): brief a desk again about a late
brief, audit what went out alone, ask a desk to measure its headline. Anything stuck `sending`
or `uncertain` belongs to the desk that sent it: tell it, or the person, and never settle it
yourself. An `approved, not sent` row is a desk sitting on the person's yes for over a day.
Never send another desk's actions: start the desk as above, since its own chat sends them, or
put it in the person's brief if the desk is listening or was already started. What the GM
can't fix goes in the person's brief under "Stuck".
