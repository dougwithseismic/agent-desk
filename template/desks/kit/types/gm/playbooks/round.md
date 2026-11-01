# The GM's round

It runs weekdays at 08:30, before the desks' own rounds, or whenever the person asks. Work as
the GM: every `desk.mjs` command takes `--as gm`. Say in a line what each step found. The
round ends with the person's brief, shown in full.

## 1. Money and funnel

Record the headline with the same summary, window and currency as last time
(`kit/playbooks/revenue.md`):

```bash
node desks/desk.mjs --as gm stripe revenue --days 28 --currency usd --record revenue-28d --desk gm
```

Then record each funnel step in `plan.md` from its source, as a measure on the gm desk. If a
source is down, that number is missing today. Never fill it in.

## 2. Every desk

```bash
node desks/desk.mjs --as gm status --json
```

Read the `watchdog` first: each row is something stalled, with what fixes it. Start the desks
nobody is listening to, and handle the rest, by `sessions.md`.

Then, for each desk in `mandate.md`, read its `board` row (headline against target, waiting,
due, in flight, uncertain), its open `briefs` and its `holds`. Note actions waiting for the
person for more than two days.

Don't fix another desk's work yourself. Something stuck becomes a line in the brief, a brief to
that desk, or a question for the person.

## 3. Audits

Audit across the desks by `kit/playbooks/audits.md`: every one in `audit_due` with trouble,
and at least one in five of the rest. A fail resets that kind's trust by itself; decide
whether it also needs a pause (`decide.md`).

## 4. Bets

```sql
SELECT * FROM gm_bet_board;
```

- A bet whose check is due (`check_due = 1`): measure the check by
  `kit/playbooks/changes.md`, then move the bet. `better` is `won`; `worse` or `flat` is
  `lost`. On `unclear`, either point the bet at a new check and say why the first window was
  too short, or drop the bet and say what you learnt. The database refuses a win or a loss
  that the check doesn't show.
- A running bet whose work is done goes to `checking`.
- A bet with no open briefs and no progress for two weeks is a question: carry on, change it,
  or drop it?

```sql
UPDATE gm_bets SET stage = 'won', last_by = :me WHERE key = 'bet:annual-plan';
```

## 5. Decide

By `decide.md`: at most three new briefs, pauses for what's failing, an initiative where the
plan has a gap, and questions for what only the person can decide.

## 6. The person's brief

By `brief.md`. Show it in full, then any actions waiting for them in full. Close as the desk
skill says, and release your locks.

Work outside the database can't be guarded, so the GM never edits code, pages or settings,
even "just this once". That work is a brief with `owner: builder`, or an initiative.
