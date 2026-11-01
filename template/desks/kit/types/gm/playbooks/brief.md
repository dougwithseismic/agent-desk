# The person's brief

Once a round, the GM talks the person through where the business stands and what it needs
from them, here in the chat. It's a conversation, not a report: no file to open, no headings,
no tables or code blocks. They can ask about any part, push back, or answer in their own
words, and the GM answers before going on.

## How it goes

1. **Where things stand**, in two or three sentences: the headline against its target, what
   moved since the last brief, and the one thing that matters most right now. A failed audit,
   or something stuck for days, belongs here too.
2. **What needs them**, one thing at a time, most money first. Ask one question and wait.
   When they answer, record it and act on it (Answers, below), then go on to the next. A
   question they want to think about stays open: say so and move on. After the questions,
   the things only they can do, a line each, with what each unblocks.
3. **The rest when they ask.** The desks one by one, what went out alone and the audits,
   holds the GM placed, briefs closed, desks it started, the watchdog's rows. Offer it in a
   line ("partners is at 3 of 10, seo is up to 112 clicks, ppc has no numbers yet: want the
   detail?") and go into any of it when they ask.

Talk the way you would to them across a desk. Short sentences, plain words. Name work by what
it is ("the 20 first emails to movers"), with an id after it when they might look it up.

- Every number comes from `measures`, never from memory. A number missing today says so, and
  why.
- "Since the last brief" is since the last brief's log row (below): `went_alone` and `briefs`
  after its time. Fails and unsures come from `audit_findings`.
- If they aren't in the chat when the round ends, the questions wait as their tasks, and the
  brief starts when they next speak.

## Questions

Each question is a task the person owns on the gm desk, with `source = 'ask'`:

```sql
INSERT INTO tasks(desk, what, owner, about, done_when, source, created_by)
VALUES ('gm', 'Raise the annual plan from $240 to $290? Yes: once you change it in Stripe, I brief the site desk to update the pricing page. No: it stays at $240. I''d say yes: 14 of October''s 20 annual buyers came from the comparison page, which lists rivals at $350 and up.',
  :person, 'bet:annual-price', 'they answer yes or no', 'ask', :me);
```

- One decision per question, answerable yes or no. Say what each answer does, then your
  recommendation and why, in a line.
- Number the open questions afresh in each brief, oldest first, and keep the numbers when you
  ask them, so that "2 yes" finds the right one even when they answer several at once. Record
  the brief before you start, with what you said in step 1 and the questions in order:

```sql
INSERT INTO log(desk, by, kind, about, summary, details)
VALUES ('gm', :me, 'note', 'gm-brief:' || :today, :said, json_object('questions', json(:questions)));
```

with `-a said='<your two or three sentences>' -a questions=[41,44,45]`, the open questions'
task ids in the order you numbered them.

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
