# Recruit: find, first touch, one follow-up

The rules for writing to people are `kit/playbooks/conversations.md`: published addresses,
holds respected, every promise a task. This adds what's particular to affiliates.

## 1. Find

Look where `icp.md` says. Record someone only when they fit, and say what you saw and where:
the issue, the review, the post. An address counts only when they publish it for this kind
of thing.

```sql
INSERT INTO people(id, name, org, role, source)
  VALUES ('jo-bloggs', 'Jo Bloggs', 'brand:jo-writes', 'Writes a newsletter on bookkeeping tools',
    'https://jowrites.example.com/about');
INSERT INTO contacts(person, channel, address, org, status, source, verified_at)
  VALUES ('jo-bloggs', 'email', 'jo@jowrites.example.com', 'brand:jo-writes', 'active',
    'https://jowrites.example.com/about', :now);
INSERT INTO affiliates_people(key, fit, audience, source, last_by)
  VALUES ('person:jo-bloggs', 'reviewed three tools like ours this year, with a link in each issue',
    'a newsletter, about 12k readers', 'https://jowrites.example.com/archive', :me);
```

## 2. The first touch

Read `facts.md` first, every time.

- **The program isn't open:** say we're starting an affiliate program, why we thought of
  them, and ask whether they'd like to hear when it opens. No rate, no cookie, no dates.
- **It's open:** the same, with the terms in a line from `facts.md` and where to apply.

Every first touch comes from the desk's own address, says in a sentence what we saw of
theirs, asks one thing, and ends with an opt-out line ("If you'd rather not hear from us,
say so and we won't write again"). Nothing about money that `facts.md` doesn't say.

```sql
INSERT INTO actions(desk, key, kind, channel, identity, about, target, title, body, evidence, status, why_human, created_by)
VALUES ('affiliates', 'first-touch:person:jo-bloggs', 'first-touch', 'email', 'partners@affiliates.example.com',
  'person:jo-bloggs', 'email:jo@jowrites.example.com', 'An affiliate program for bookkeeping tools', :body,
  json_array('https://jowrites.example.com/archive'), 'waiting', 'first touches wait for a person until trusted and allowed', :me);
```

Once it's sent, they're `contacted`:

```sql
UPDATE affiliates_people SET stage = 'contacted', last_by = :me WHERE key = 'person:jo-bloggs';
```

## 3. One follow-up

At most one, after the wait in `desk.md` (five working days to start with), in the same
thread, short, with the one question. Its key follows the first touch:
`follow-up:person:jo-bloggs:1`. Check the thread and the holds first, as
`conversations.md` says. No answer after it: `closed`, with "no answer" in `notes`.

## 4. Replies

| They say | Do this |
| --- | --- |
| Yes, before the program opens | `interested`, with their words, and a task to tell them when it opens (below) |
| Yes, once it's open | A `reply` with where to apply. They're `applied` once the product shows it (`onboard.md`) |
| A question `facts.md` answers | A `reply` from `facts.md` |
| A question about money it doesn't answer | A task for the person with the thread. Commit to nothing |
| No | `closed`, with their words. No follow-up, ever, for this |
| Don't write again | `closed`, and a hold on their address, topic `all` (`conversations.md`) |

A yes before the program opens is a promise to tell them, so it's a task, `blocked` until
the program opens:

```sql
UPDATE affiliates_people SET stage = 'interested', notes = 'yes: "happy to hear when it opens"', last_by = :me
  WHERE key = 'person:jo-bloggs';
INSERT INTO tasks(desk, what, owner, about, status, done_when, source, created_by)
  VALUES ('affiliates', 'Tell Jo the program is open, and where to apply (blocked: the program opens)', 'agent',
    'person:jo-bloggs', 'blocked', 'a reply in their thread says it''s open and where to apply', 'first-touch:person:jo-bloggs', :me);
```

## 5. When the program opens

Only the person opens it, with terms they set: `facts.md` changes first, its `Program:` line
too. Then everyone waiting hears, in their own thread:

```sql
UPDATE tasks SET status = 'open', due = :today
  WHERE desk = 'affiliates' AND status = 'blocked' AND what LIKE '%(blocked: the program opens)'
    AND about IN (SELECT key FROM affiliates_people WHERE stage = 'interested');
```

Each is a `reply`: it's open, the terms in a line, and where to apply.
