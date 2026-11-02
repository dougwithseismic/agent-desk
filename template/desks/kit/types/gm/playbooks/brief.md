# The person's brief

Once a round, the GM talks the person through what we're aiming for, what gets done today and
by whom, and what it needs from them, here in the chat. It's a conversation, not a report: no
file to open, no headings, no tables or code blocks. They can ask about any part, push back, or
answer in their own words, and the GM answers before going on.

It's about the business, not the machinery. How the GM got its numbers, which reads were slow,
which sessions it started or set up, locks, and audits that passed aren't the brief unless they
change today's plan. The person should come away knowing what we're trying to do, what happens
today and who does it, and what they have to decide.

## How it goes

1. **The aim**, in two or three sentences: the goal in the mandate's words, the headline
   against its target, and the gap in plain numbers ("0 of 3,500 Kč, 59 days left"). Then this
   week's aims (Aims, below), each with where it stands.
2. **The last plan**: what the last brief said would happen, and what did, a line each. Say
   why anything didn't, and whether it moves to today. Skip it on the first brief.
3. **Today**, most money first: what each desk does today and which aim it serves, one to three
   things a desk, named by what they are ("Clara sends the 20 first emails to movers, for the
   first-paid-place aim"). Then what only the person can do today, a line each, with what it
   unblocks. A desk with nothing today that moves an aim gets no line. A failed audit, a pause,
   or anything stuck that stops part of the plan goes here, with what it stops.
4. **What needs them**, one question at a time, most money first. Ask and wait. When they
   answer, record it and act on it (Answers, below), then go on to the next. A question they
   want to think about stays open: say so and move on.
5. **The rest when they ask**: the desks one by one, what went out alone and the audits, holds,
   briefs closed, desks started, the watchdog's rows. Offer it in one line ("audits all passed,
   seo is at 112 clicks: want the detail?") and go into any of it when they ask.

Talk the way you would to them across a desk. Short sentences, plain words. Name work by what
it is, with an id after it when they might look it up.

- Every number comes from `measures`, never from memory. A number missing today says so, and
  why, in a line.
- Today's plan comes from each desk's due tasks and checks, actions approved and not yet sent,
  open briefs and its round (`round.md`, step 2). Plan only what a desk can do today; what waits
  on the person is theirs.
- What went out alone since the last brief is `went_alone` after its time; fails and unsures
  come from `audit_findings`.
- If they aren't in the chat when the round ends, the questions wait as their tasks, and the
  brief starts when they next speak.

## Aims

This week's aims say what the goal needs by the end of the week: at most three, each a number
by a date, each closing part of the gap or unblocking what will ("the first paid place signed
by Friday", "ppc's first cost per alert read, under 100 Kč"). Set them in the week's first
brief, from the running bets, the weakest funnel step and each desk's next step to its target,
and say why each. Keep them all week. In the week's last brief, say which were met and what
that taught us. The person can change them: their words are the aims.

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
  ask them, so that "2 yes" finds the right one even when they answer several at once.

## Recording the brief

Before you talk, read the last brief's aims and plan:

```sql
SELECT about, json_extract(details, '$.aims') AS aims, json_extract(details, '$.plan') AS plan
FROM log WHERE desk = 'gm' AND about GLOB 'gm-brief:*' ORDER BY about DESC, id DESC LIMIT 1;
```

Then record this brief: what you'll say in step 1, the week's aims, today's plan and the open
questions in the order you numbered them.

```sql
INSERT INTO log(desk, by, kind, about, summary, details)
VALUES ('gm', :me, 'note', 'gm-brief:' || :today, :said,
  json_object('aims', json(:aims), 'plan', json(:plan), 'questions', json(:questions)));
```

with `-a said='<your two or three sentences>'`,
`-a aims='["first paid place signed by Fri 6 Nov"]'`,
`-a plan='["partners: the 20 first emails to movers (#360-379)", "you: the 490 Kč product in Stripe"]'`
and `-a questions=[41,44,45]`, the open questions' task ids.

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
