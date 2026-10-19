# Working together

Everyone on a desk uses the same database. For one person on one machine, that's a file
(`desks/data/desk.db`). When several people or machines share the work, it's the hosted
one (`hosting.md`). There are no accounts: each person sets their name once, in
`desks/.env`:

```sh
DESK_USER=doug
```

An agent acts as the person it works for, so Doug's agent is `doug`. Give a second agent
of yours running at the same time its own name (`DESK_USER=doug-builder`), so your locks
keep it off your work.

## Locks: who's working on what

A lock is a key and a few words: "I'm working on this". Anyone can see it, and nobody has
to ask anyone anything.

```sh
node desks/desk.mjs lock brand:acme "replying to Jo about PPC terms"
node desks/desk.mjs unlock brand:acme
node desks/desk.mjs take brand:acme "Sam's away; sending the follow-up"
```

- **Lock before you start** on anything someone else might pick up: a brand you're
  writing to, a page you're changing, a campaign you're editing. Use the thing's key. For
  a whole job across many things, lock each thing, or a key for the job
  (`job:title-rewrites-oct`).
- **Held by someone else?** Leave it and pick other work. `lock` says who has it, since
  when, and what they're doing.
- **Need it anyway?** `take` it. The takeover is logged with what they were doing, so
  they'll see it. Do this when the lock is old and forgotten, or the person said so. Don't
  do it to get past someone mid-send.
- **Finished?** `unlock`. Release everything at the end of the session unless you're
  holding something on purpose, and say so.
- Locks don't expire. `status` shows how many hours each one has been held.

The send gate checks locks for you. An action can't be sent while someone else holds a
lock on its `about` or `target`, the target's domain, the person behind the address, or
`action:<id>`. Your own locks never block you.

## Claims: one worker per send

Sending is claimed by the status change itself, which only one worker can win
(`actions.md`). Two agents racing to send the same approved email: one sends it, the
other gets nothing back.

## Something stuck in `sending`

A row that has been `sending` for more than a few minutes means the sender may have
stopped mid-way. Check the provider: the Sent folder, the API, the live page. Then settle
it:

- `sent` or `verified` if it happened;
- `failed` if it definitely didn't;
- `uncertain` if you can't tell, and tell the person.

Never send it again because the worker looks dead. A deliberate new try is a new action
with its own key, after the old one is settled.

## Seeing what others did

- `status` shows waiting, due, in flight, locks and holds for every desk.
- The log says who did what, when: `SELECT at, by, kind, about, summary FROM log ORDER BY id DESC LIMIT 30`.
- `last_by` on an action says who touched it last.

Work someone else prepared is fine to finish. Read its history first, and don't redo
what they did.

## Handing work to a builder

A builder is another agent session doing a bounded job, such as building a page or
fixing a feed. Give it:

- the job;
- the keys it owns (it locks them);
- the existing approval, if any;
- the check that proves it's done.

It records its own results in the database (it needs `DESK_USER` and the same
`DESK_DB`). If it can't, you check its work and record it. A builder finishing a page
doesn't approve an email announcing it: that's a new action.
