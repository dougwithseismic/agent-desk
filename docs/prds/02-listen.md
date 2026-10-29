# PRD 02: Listening in the desk skill, and the mailbox rules

## Goal

`/desk <name> listen` turns a session into that desk at work: it catches up, then waits for
mail and answers each email as it lands, in the chat, where the person can step in at any
time. The playbooks also stop desks reading the person's own inbox.

## Locked decisions

- The way in is `/desk <name> listen` (or "listen for mail on the partners desk"). No
  per-desk command.
- The session runs `node desks/desk.mjs watch <name>` as a background command, and is woken
  when it exits. A Monitor works the same way, since events go to stdout.
- A wake is the round's inbox step for the emails named, nothing more: read the thread,
  record it in `inbox`, prepare what's needed, show anything waiting in full, send only what
  the database lets go on its own. No new outreach, no builder work, no measuring on a wake.
- Then start `watch` again. On a "no new mail" exit, start it again without comment.
- On a failure exit, say what failed in one line and stop listening, unless it's clearly
  passing (then try once more).
- "Stop listening" stops the background command and releases `listen:<name>`.
- A desk owns its addresses (`Mail:`), on a subdomain whose MX is the project's mail Worker.
  It never reads the person's own inbox: their forwarded copy is for them.
- Cold first touches through a Workspace "Send mail as" alias BCC the desk's own address,
  so the Worker keeps the sent copy.
- Mail that belongs to another desk is recorded in `inbox` with that desk's name, unhandled.
  That desk's `watch` picks it up.

## Acceptance criteria

- WHEN someone says `/desk partners listen`, the skill SHALL open the desk, do the inbox step
  for anything already waiting, start `watch partners` in the background and say in one line
  that it's listening, to which addresses.
- WHEN `watch` reports new mail, the skill SHALL handle exactly those emails by the inbox
  playbook, show any action waiting in full, and start `watch` again.
- WHEN the person writes in the session while it listens, the skill SHALL answer them and keep
  listening.
- `conversations.md` SHALL say a desk reads only the addresses it owns, how a handover works,
  and that alias sends BCC the desk's address.
- `new-desk` SHALL give a desk that talks by email its own address and a `Mail:` line, and
  SHALL ask before any Cloudflare change.
- The desk skill's "background runs only when asked" rule SHALL name listening as the asked-for
  case.

## Tasks

1. `template/.claude/skills/desk/SKILL.md`: a "Listening" section; the close and hard rules
   updated.
2. `template/desks/kit/playbooks/conversations.md`: "Mailboxes" section; the inbox section
   points at handovers.
3. `template/.claude/skills/new-desk/SKILL.md`: the address and `Mail:` line step.
4. `template/desks/kit/guide/anatomy.md` and `kit/guide/examples/outreach.md`: the `Mail:` line.
5. `README.md` (repo) and `template/desks/README.md`: listening, in a few lines.

## Implementation Notes

- The desk skill has a "Listening" section (open, catch up, `watch` in the background, a
  wake is the inbox step only, restart, failures, stop). The close and hard rules now name
  listening as the asked-for background run, and a desk reads only its `Mail:` addresses.
- `conversations.md` has a "Mailboxes" section: owned addresses, never the person's inbox,
  handovers, and alias sends BCC the desk. Its inbox example uses `mail:` ids, and "already
  answered" checks the thread and the desk's sent mail, not the person's mailbox.
- `new-desk` proposes an address for an email desk, writes the `Mail:` line, offers the
  kit's Worker, and asks before any Cloudflare change.
- The outreach worked example now has a `Mail:` line in place of reading Gmail.
- Open: reading a thread from the Worker in the skill depends on `desk.mjs mail` (PRD 04).
