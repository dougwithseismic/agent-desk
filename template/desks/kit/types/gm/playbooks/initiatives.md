# Initiatives: bets the desks can't do with what they have

An initiative is a bet that needs something new: something built, a new desk, or outside work
such as a partner program or an agency. It always waits for the person, however many they've
approved before. The database refuses to start one on its own.

## 1. The bet

A row in `gm_bets`, stage `proposed`, with the evidence and the effect it expects:

```sql
INSERT INTO gm_bets(key, what, why, expects, owners, source, last_by)
VALUES ('bet:affiliates', 'Start an affiliate program for the Pro plan',
  '6 of the last 20 Pro sign-ups came from two creators who mention us unpaid',
  'customers-28d up 15% within 90 days of launch', json_array('affiliates'),
  'stripe customers; plan.md funnel, 2026-11-03', :me);
```

## 2. The initiative

An action on channel `gm`, about the bet:

```sql
INSERT INTO actions(desk, key, kind, channel, identity, about, target, title, body, status, why_human, created_by)
VALUES ('gm', 'initiative:affiliates', 'initiative', 'gm', 'gm', 'bet:affiliates', 'bet:affiliates',
  'Start an affiliate program for the Pro plan', :body, 'waiting', 'an initiative always waits for the person', :me);
```

The body says, in plain words:

- the bet and its evidence;
- what has to be built or set up, and by whom;
- what it costs, in money and in the person's time;
- the check that will say whether it worked;
- the first step.

In the person's brief it's one of the things that need them: when you reach it, show it in
full and ask: go, change or drop?

## 3. Once approved

Claim it as a human send, the way `kit/playbooks/actions.md` claims any action that doesn't go
through `send`. Then set it going in the same sitting, so it isn't left `sending` (a send that sits there
looks stuck):

1. **What needs building** becomes a PRD in the project's own plan (its `docs/`, or wherever
   it keeps them), written from the initiative, then a task per piece on the gm desk with
   `owner = 'builder'` and a `done_when`. Building is a builder's work, never the GM's.
2. **A new desk**, if it needs one, is a task for the person on the gm desk: setting it up
   together (`new-desk`), from a type when one fits.
3. **Briefs** to the desks that will do the work (`decide.md`).
4. **The baseline**: a check on the bet's measure (`kit/playbooks/changes.md`), with
   `about` the bet's key and `action_id` the initiative.
5. **The bet runs**: set `stage = 'running'` and `check_id`. Set the action `sent`, with `provider_ref` naming the PRD or the first brief, and `verified` once you've
   seen the builder tasks and briefs taken up.

From then on it's a bet like any other (`round.md`, step 4).

A no is recorded like any rejection, with their words; then the bet is `dropped` with the
reason in `notes`.

An affiliate program is the usual first one: the bet, a PRD for referral tracking and payouts
in the product, builder tasks for it, then an affiliates desk to recruit and look after
affiliates.
