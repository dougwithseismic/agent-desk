# Deciding what the desks do next

`mandate.md` says what the GM may decide alone. Anything it doesn't cover is a question for
the person.

| Decision | What it is | Alone? |
| --- | --- | --- |
| brief | an action on channel `desk` (`kit/playbooks/briefs.md`) | once the kind is trusted and allowed |
| pause | a hold on a desk's kind of work or on a target | yes: it only tightens |
| audit | a row in `audits` (`kit/playbooks/audits.md`) | yes |
| initiative | an action on channel `gm` (`initiatives.md`) | never: it's shown every time |
| ask | a task the person owns, with source `ask` (`brief.md`) | yes: it only asks |

What `mandate.md` keeps for the person is always a question.

## What's worth doing

Start from the gap between the headline and its target, and the funnel step that has
weakened most against its own past. Pick work that meets `desk.md`'s Criteria, within its
Limits, and rank it by money moved for the effort. Fewer is fine. A round with no new brief,
because the desks have enough to do, is a good round.

## Briefs

Write each one by `kit/playbooks/briefs.md`, with identity `gm`. When it serves a bet, set
`about` to the bet's key, so `gm_bet_board` counts its open briefs. Show any that wait after
the person's brief, and send with `node desks/desk.mjs --as gm send <id>`.

## Pauses

A hold stops one desk's kind of work, or everything about one target, until it's lifted
(`kit/playbooks/conversations.md`, "Do not contact, and other holds"):

```sql
INSERT INTO holds(desk, about, topic, reason, source, by)
VALUES ('partners', '*', 'first-touch', 'audit #12 failed: two first emails named the wrong product', 'audit:12', :me);
```

Pause when an audit fails, when `audit_due` shows trouble (bounces, complaints or opt-outs
since the send), or when a desk's measure falls well outside its usual swing. Put the pause
and its reason in the person's brief. Lift your own hold once the cause is fixed.

## Questions

Whatever the mandate leaves to the person becomes a question (`brief.md`): yes or no, what
each answer does, and your recommendation. Ask once. An open question appears in every brief
until it's answered or dropped.

## Recording

Each decision the GM makes alone is a row: the brief, the hold, the audit, the question. A
decision the person makes goes in the log in their words (`brief.md`), and is then acted on.
