# Writing in their name

Their own words and edits are the source of their voice. A generic template, a polished
example from somewhere else, or your preferred style isn't.

## Before writing

Read what applies:

- the facts the desk may state (in `desk.md` or the desk's own playbook);
- approved examples of this kind: earlier verified actions,
  `SELECT title, body FROM actions WHERE desk = :desk AND kind = '...' AND status = 'verified' AND edited = 0 ORDER BY id DESC LIMIT 5`;
- lessons for this kind and channel;
- the thread or source you're answering.

Every claim needs a source. If a fact is missing or uncertain, ask for it once. Don't
write around the gap.

## Their words first (the first two of each kind)

While a kind is still being learnt (`stage = 'coached'`):

1. Say what this message is for and who gets it.
2. Ask one question: "What would you want them to know, in your words?" A few rough words
   are plenty. It isn't a form.
3. Tidy spelling, order and length, keeping their meaning, tone and phrases. Don't add a
   claim, promise, urgency, recipient, file or sign-off they didn't give.
4. Show the result in full (`actions.md`) and act on their answer.

"Just write it" skips this for that kind (`actions.md`, Trust).

## Your drafts

After coaching, draft from their approved examples, the facts, the thread and the
lessons. Match their spelling, formality, sign-off and usual length. Check every draft:

1. Every claim is backed by a fact, a source or the thread.
2. Names, roles, dates, links, recipients and the sending identity match the source
   exactly.
3. The purpose is clear in the first line, with one clear ask.
4. Nothing reserved for them: no money, contracts, legal points, dates or commitments
   unless the facts and their say-so cover it.
5. Files, links and quoted history are intended and present.
6. No placeholders, no "I hope this finds you well", and nothing they've told you not to
   say.

## Learning from edits

When they change a draft, ask yourself what the change teaches. Record it as a lesson for
that kind and channel, in a sentence another session can act on:

```sql
INSERT INTO lessons(desk, kind, channel, action_id, lesson, source, by)
VALUES (:desk, 'first-touch', 'email', 12, 'Never mention competitors by name', 'Doug edit, 17 Oct', :me);
```

A lesson that changes an earlier one names it in `replaces`. Read the latest lessons
before every draft of that kind.
