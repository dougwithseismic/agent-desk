# Actions: prepare, show, approve, send, verify

An action is anything that goes out into the world or changes it: an email, a LinkedIn
message, a title change on a page, a bid change, a booking. Save it exactly as it will go
before it goes. The database then moves it through these states and refuses anything
else:

```text
draft ─► waiting ─► approved ─► sending ─► sent ─► verified
  │         │          │           │         │
  │         └─► rejected / dropped └─► failed / uncertain ─► (checked) sent / verified / failed
  └─► sending (mode auto, only when trusted and allowed)
```

| Status | Means |
| --- | --- |
| `draft` | Prepared, not shown. Only a trusted, allowed draft may go on its own. |
| `waiting` | Needs a person: send, change or drop. |
| `approved` | A person said yes to this exact version. |
| `sending` | One worker has claimed it and is doing it now. Nobody else can. |
| `sent` | The provider took it: in Sent, a 200 from the API, the PR merged. |
| `verified` | Checked where the result really lives: the reply in the thread, the new title on the live page. |
| `failed` | Definitely didn't happen. Final: a new try is a new action. |
| `uncertain` | Might have happened. Never retry; check, then settle it as `sent`, `verified` or `failed`. |
| `rejected` | The person said no, and trust for that kind starts again. |
| `dropped` | No longer needed. |

The database keeps the original wording (`first_*`). It bumps `version` on every content
change, and marks `edited` when the change came after a person saw it. It writes a log
row for every move.

## Prepare

```sh
node desks/desk.mjs sql -a body=@desks/data/outreach/acme-reply.txt - <<'SQL'
INSERT INTO actions(desk, key, kind, channel, identity, about, target, title, body, payload, evidence, why_human, created_by)
VALUES ('outreach', 'reply:gmail:18c2f9a', 'email-reply', 'email', 'doug@partners.example.com',
  'brand:acme', 'email:jo@acme.com', 'Re: PPC terms', :body,
  json_object('thread', 'gmail:18c2f9a', 'cc', json_array('doug@example.com'), 'files', json_array()),
  json_array('gmail:18c2f9a', 'awin:programme/12345'),
  'still learning their words; mentions commission', :me);
SELECT id, stage FROM actions WHERE id = last_insert_rowid();
SQL
```

Read the stage back with that `SELECT`, in the same call. `RETURNING` shows the row
before the database sets its stage, so it always says `drafted`.

- **key**: where the work came from plus what it's for, stable, so the same work is never
  prepared twice. Examples: `reply:gmail:<thread>`, `first-touch:brand:acme`,
  `title:page:/stores/nike:2026-10`. A second deliberate try gets its own key
  (`...:retry1`).
- **kind, channel, identity**: what it is, where it goes, who it acts as. Trust is earned
  for each combination separately.
- **about** is the thing it concerns. **target** is the exact recipient or object. Put
  copies in `payload` as `{"cc": [...], "bcc": [...]}`, addresses only. Holds and locks
  are checked against all of them, their domains, and the people behind them.
- **payload**: everything else that makes it this action. That covers the thread to reply
  in, files with their sha256, form fields, and the exact change. The provider's
  signature is part of the content: include it, or turn it off and write it in the body.
- **evidence**: references someone could reopen.
- **why_human**: every reason it waits, in plain words. Leave it null only for a draft
  you expect to go on its own.
- `status` starts as `draft` (not shown yet) or `waiting` (ready to show).

## Show it

Show it in full, every time:

```text
#12 · email-reply · Acme · v1
From doug@partners.example.com to jo@acme.com, cc doug@example.com
Subject: Re: PPC terms

<the whole body, exactly as it will go>

Rests on: Jo's email of 14 Oct asking for terms; Awin programme 12345 (approved 2 Oct).
Waiting because: still learning your words (1 of 2); it mentions commission.
Send, change or drop?
```

## Their answer

**Send / yes / looks good.** This approves the version they saw:

```sql
UPDATE actions SET status = 'approved', approved_by = :me, approved_version = 1,
  approval_words = 'yes send it', last_by = :me WHERE id = 12;
```

If anything changed since they saw it, the database refuses with "this changed since it
was shown". Show the current version and ask again. "Send 3 and 5" approves those two
versions only.

**Change it.** Update the content. The database bumps the version, clears any approval
and marks it edited (trust for that kind starts again). Record what they taught you,
then show it again:

```sql
UPDATE actions SET body = :body, last_by = :me WHERE id = 12;
INSERT INTO lessons(desk, kind, channel, action_id, lesson, source, by)
  VALUES ('outreach', 'email-reply', 'email', 12, 'Lead with the answer; no pleasantries', 'Doug, 17 Oct', :me);
```

If their answer covers the new version ("make it shorter and send"), approve the new
version straight away.

**Drop it.** Use `rejected` when it was wrong (trust starts again) and `dropped` when it's
simply not needed. Say why in `result`, record the lesson, and ask nothing more about it:

```sql
UPDATE actions SET status = 'rejected', result = 'wrong brand', last_by = :me WHERE id = 12;
```

**Later, or no answer.** Leave it waiting. Silence never approves anything.

## Send

1. **Claim it.** The claim is the status change itself. Exactly one worker gets the row
   back; anyone else gets nothing back, or the refusal "already being sent":

   ```sql
   UPDATE actions SET status = 'sending', mode = 'human', sent_by = :me, last_by = :me
   WHERE id = 12 AND status = 'approved' RETURNING id;
   ```

   No row back means it isn't yours to send: stop. A refusal (held, locked) means do what
   it says.
2. **Check again, right before.** Look for a newer reply in the thread, check the
   recipients and file hashes, and check the provider is healthy and within limits. If
   anything changed, set it back with `status = 'failed'`, `result = 'not sent: <why>'`,
   then prepare a new action.
3. **Do exactly the stored version** with the desk's tool (mail command, API, browser,
   PR).
4. **Record what happened at once.** If the provider took it, set `status = 'sent'` with
   `provider_ref` = its id. If it refused, set `status = 'failed'` with what it said in
   `result`. A timeout, a crash, or anything you can't be sure of is `status = 'uncertain'`.
5. **Verify where it lives.** Look in the thread or Sent folder, fetch the live page, or
   read the setting back. Then `UPDATE actions SET status = 'verified', verify_ref = ...,
   result = 'in the thread at 14:02'`. Provider acceptance alone isn't verified. Record
   any promise it made as a task.

**On its own (mode auto).** A draft that has earned trust, and that a person has allowed,
goes without being shown:

```sql
UPDATE actions SET status = 'sending', mode = 'auto', sent_by = :me, last_by = :me
WHERE id = 31 AND status = 'draft' RETURNING id;
```

If the database answers "spot check due", show this one in full:
`UPDATE actions SET status = 'waiting', spot_check = 1, why_human = 'spot check' WHERE id = 31`.
Then tell them in the round summary what went out on its own.

## Trust

Trust is learnt for each kind, channel and identity (`trust`, shown in words by `trust_board`):

| Stage | Until | What happens |
| --- | --- | --- |
| Their words | 2 examples verified (`coach_needed`) | Ask what they'd say, tidy it keeping their words (`voice.md`), and show it |
| Drafts | 5 in a row approved unchanged and verified (`needed`) | You write; they review every one |
| Trusted | An edit or rejection | Allowed drafts go on their own; every 5th waits as a spot check (`check_every`) |

The database does the counting:

- A coached example counts toward `coached` when verified.
- An unchanged, human-approved draft adds 1 to `clean` when verified, and resets the
  spot-check count.
- Five clean in a row make it `trusted`.
- An edit or rejection sets `clean` back to 0, removes trust, and moves `epoch` on. An
  approval from before that no longer counts.
- Automatic sends never add to `clean`.

Tell them when trust is earned or lost, and how to take it back.

Trust is quality, not permission. Going out alone also needs their say-so in `allowed`,
in their words, for that kind, channel and identity:

```sql
INSERT INTO allowed(desk, kind, channel, identity, scope, words, by)
VALUES ('outreach', 'email-reply', 'email', 'doug@partners.example.com',
  'replies in existing threads; nothing about money', 'yeah let routine replies go', :me);
-- taking it back
UPDATE allowed SET revoked_at = :now, revoked_by = :me WHERE id = 3;
```

Other things they can say:

- **"Just write it"** skips coaching for that kind.
- **"Always ask me about X"** (money, contracts, anything they reserve) means it never
  goes alone, whatever the score.
- **Trust given directly** counts only when they say so. Never simulate approvals.

A trust row appears with the first action of its kind, so set these with an upsert:

```sql
INSERT INTO trust(desk, kind, channel, identity, coach_needed, note)
VALUES ('outreach', 'email-reply', 'email', 'doug@partners.example.com', 0, 'Doug: just write it (17 Oct)')
ON CONFLICT(desk, kind, channel, identity) DO UPDATE SET coach_needed = 0, note = excluded.note;
-- "always ask me": always_human = 1     given directly: trusted = 1, note = '<their words>'
```

An `allowed` row and the trust ladder carry over between sessions and people: don't ask
again just because a new chat started. Ask only when it's missing, revoked, expired or
doesn't cover this action.

## When the database refuses

| It says | Do this |
| --- | --- |
| this changed since it was shown | Show the current version and ask again |
| held: a hold or do-not-contact covers this | Leave it waiting with the reason; tell them which hold. Only they release holds |
| locked: someone else is working on this | Leave it, or take the lock over if they meant you to (`together.md`) |
| already being sent | Someone else has it; move on |
| still learning / not trusted / spot check due | Show it for review |
| nobody has allowed this to go out on its own | Show it for review; ask once whether such actions may go alone |
| that status change is not allowed | Read the path in the message; failed and rejected are final, so make a new action |
| already attempted ... content cannot change | Make a new action with a new key |
| the log is never changed | Add a new log row that corrects it |
