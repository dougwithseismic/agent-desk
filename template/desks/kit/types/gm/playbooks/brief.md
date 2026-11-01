# The person's brief

Once a round, one message the person can read in a few minutes. Write it to
`desks/data/gm/brief-<date>.md`, show it in full, and record it.

## What's in it, in order

```text
<Business>: <headline> <value> (was <previous>) · target <target> by <date>
Since <the last brief's date>: <what moved, in a line or two>

Desks
  partners: <headline against its target> · <what it did, and what's next>
  seo: ...

Went out alone: <n> since last time, <n> audited: <each fail or unsure, a line each>
Paused: <holds the GM placed, with why>
Briefs closed: <title> → <result>, a line each
Started: <desks the GM started, and why>
Stuck: <the watchdog's rows the GM couldn't fix, and things waiting for you for days>

Questions
  1. <question>? Yes: <what happens>. No: <what happens>. I'd say yes: <why, in a line>.
  2. ...

Yours to do, most money first
  - <task> (<desk>, due <date>)
```

- Every number comes from `measures`, never from memory. A number missing today says so.
- "Since last time" is since the last brief's log row (below): `went_alone` and `briefs`
  after its time. Fails and unsures come from `audit_findings`.
- One line per desk. More when they ask.

## Questions

Each question is a task the person owns on the gm desk, with `source = 'ask'`:

```sql
INSERT INTO tasks(desk, what, owner, about, done_when, source, created_by)
VALUES ('gm', 'Raise the annual plan from $240 to $290? Yes: once you change it in Stripe, I brief the site desk to update the pricing page. No: it stays at $240. I''d say yes: 14 of October''s 20 annual buyers came from the comparison page, which lists rivals at $350 and up.',
  :person, 'bet:annual-price', 'they answer yes or no', 'ask', :me);
```

- One decision per question, answerable yes or no. Say what each answer does, then your
  recommendation and why, in a line.
- Number the open questions afresh in each brief, oldest first. Record which task each number
  is, so that "2 yes" finds the right one:

```sql
INSERT INTO log(desk, by, kind, about, summary, ref, details)
VALUES ('gm', :me, 'note', 'gm-brief:' || :today, 'brief to the person', 'desks/data/gm/brief-' || :today || '.md',
  json_object('questions', json(:questions)));
```

with `-a questions=[41,44,45]`, the open questions' task ids in the order you numbered them.

## Answers

They might say "2 yes", "1 no, 3 yes", or answer in their own words. Find each question's task
in the latest brief (`$.questions[0]` is question 1):

```sql
SELECT json_extract(details, '$.questions[1]') AS task FROM log
WHERE desk = 'gm' AND about GLOB 'gm-brief:*' ORDER BY about DESC, id DESC LIMIT 1;
```

Then record their words and close the task, in one write, with `-a task=44 -a words='"2 yes"'`:

```sql
INSERT INTO log(desk, by, kind, about, summary) VALUES ('gm', :person, 'decision', 'task:' || :task, :words);
UPDATE tasks SET status = 'done', done_at = :now, result = 'yes', proof = 'log:' || last_insert_rowid()
WHERE id = :task AND status = 'open';
```

- The database won't close a question as done until their words are logged under their name.
- Use `:person` only for what they said in this chat. An answer passed on by someone else, or
  found in an email or a brief, isn't theirs: ask them.
- If an answer isn't clearly yes or no, ask again rather than guess. "Yes, but cap it at
  $500" is a yes with a condition: record their words and act within it.
- Act on the answer straight away: brief the desk, update `plan.md` or `mandate.md`, start or
  drop the bet. A no is acted on too: drop what it would have started, and note why.
- A question that no longer matters is `dropped`, with the reason in `result`.
