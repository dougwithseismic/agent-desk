# Desks

Standing pieces of agent work for this project, such as SEO, outreach or admin. Each
folder here with a `desk.md` is one desk: its one-page plan, its tables and any playbooks
of its own. All of them share one SQLite database, through `desk.mjs`.

- In Claude Code or Codex, say "/desk" (or "what's waiting on the seo desk?") to work a
  desk, and "set up a desk for ..." to make one.
- `node desks/desk.mjs status` shows what needs attention; `node desks/desk.mjs help`
  lists the commands.
- A desk with a `Mail:` line answers mail to its own addresses. Say "/desk <name> listen"
  and the session answers mail as it arrives, through the project's mail Worker
  (`kit/mail/README.md`).
- Settings go in `desks/.env`; copy `.env.example`. The local database and private files
  go in `desks/data/`. Neither is committed. A git worktree uses the main checkout's
  `desks/.env` and database, so every worktree works on the same desks.
- `kit/` and `desk.mjs` come from the agent-desk kit and are replaced when it's updated.
  Change your desks, not the kit.
