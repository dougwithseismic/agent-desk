# Audits: checking work nobody read

Trusted work goes out on its own, and a person reads only every fifth one. An audit is how
the other four get checked: someone who didn't do the work reads it afterwards and says
whether it was right. A GM audits the desks it runs, and the person can audit anything,
the GM included.

An audit that fails takes trust away from that kind of action, as a rejection does
(`actions.md`), so nobody has to notice the drift by hand.

## What's due

```sql
SELECT * FROM audit_due WHERE desk = :desk ORDER BY trouble > 0 DESC, sent_at DESC;
```

`audit_due` lists what went out on its own in the last 14 days with no audit yet. `trouble` counts holds placed since on anything it touched: a bounce, a complaint and
an opt-out each become a hold, so those come first. `status` shows how many each desk has.

Each week, for each desk you audit:

- every one with `trouble`;
- at least one in five of the rest, spread across kinds and identities, not just the
  newest;
- the headline number, when the desk reported one (`measures`).

## Nobody audits their own work

The database refuses an audit by whoever created or sent the action, recorded the measure,
or created the task. A desk without its own `Agent:` works as the person, so the person
can't audit that desk's work: another desk's agent does, such as the GM, working
with `--as`.

## What to check

Read it as the person would, then check it against what it rests on:

1. **The draft.** Run `voice.md`'s draft checklist against what went out, and the desk's
   lessons. Above all, nothing reserved for the person (money, contracts, legal points,
   dates, commitments) without the facts and their say-so. A rate we don't offer or a date
   nobody agreed is a fail.
2. **Criteria and limits.** What the desk's `desk.md` says it may and may not do.
3. **Holds.** Nothing it touched was held when it went.
4. **What happened after.** The reply, the bounce, the page as it is now. Read the thread or
   fetch the page; don't trust the log alone.

For a measure, read the number again the way it was defined: same source, same filters,
same window (`changes.md`). Read any other way, a different number isn't a fail. For a task,
check the proof meets its `done_when`.

## Write the verdict

```sql
INSERT INTO audits(desk, checked, verdict, notes, evidence, by)
VALUES ('partners', 'action:41', 'fail', 'promised 30% commission; the programme pays 20%',
  json_array('mail:partners@mail.example.com:5d1e', 'awin:programme/12345'), :me);
```

- **checked** is `action:<id>`, `measure:<id>` or `task:<id>`, and **desk** is that desk.
- **verdict** is `pass`, `fail` or `unsure`.
- **notes** say what you checked and what you found, so someone else can follow it.
- **evidence** lists refs someone could reopen: the thread, the page, the report. A `fail` or
  `unsure` needs at least one.

An audit never changes. If you got it wrong, or the desk fixed it, audit it again: the newest
audit of a thing is the one that counts.

## After it

- A `fail` on an action has already reset trust, and the log says which audit did it. Add
  the lesson to the desk (`lessons`), so the mistake isn't made again, and tell the person.
- A `fail` on a measure or task resets nothing. Put it to the desk as a brief, or to the
  person.
- An `unsure` goes to the person, with the evidence and what you couldn't tell.

```sql
SELECT * FROM audit_findings ORDER BY id DESC;
```

`audit_findings` lists every fail and unsure until a later audit of the same thing says
otherwise. They belong in the GM's brief to the person.
