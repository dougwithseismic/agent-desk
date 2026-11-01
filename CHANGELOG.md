# Changelog

What changed in the desk kit, newest first. Update a project with `node bin/kit.mjs <project>`.

## 2026-11-01

### The GM talks you through its brief in the chat · Improved
- The GM's brief is now a conversation in its chat instead of a file: where things stand in
  a few sentences, then one question at a time, so you can discuss each before answering.
  The desks, audits and the rest come up when you ask.

### Desks find the Stripe key themselves · Improved
- `DESK_STRIPE_KEY=stripe-cli:<profile>` reads through a Stripe CLI login you already have
  (with `stripe get`, so the key stays in the CLI), and `env:<NAME>` uses a key the project
  already keeps in another variable. A desk looks for those before asking you for a
  restricted key. `doctor` says where the key came from and, for a CLI login, until when it
  lasts.
- A live secret key is still refused, wherever it comes from.

### The watchdog shows what you approved that nobody has sent · Fixed
- Actions you approved that still haven't gone a day later now show under "Stalled" in
  `status`, one line per desk: how many, the oldest, and what fixes it (open the desk's
  chat, or send them). Before, the watchdog only counted a desk's due tasks and checks, so
  approved sends could sit for days with nobody told.

### An affiliates desk recruits, onboards and pays affiliates (PRD 17) · New
- Say "set up an affiliates desk" and `new-desk` starts from the affiliates type. It asks
  whether the product has a program yet, who makes a good affiliate, the desk's own address
  and how you pay, and writes your terms down only if you've set them.
- Before the program opens, the desk finds people who'd recommend the product and asks
  whether they'd like to hear when it opens, promising no rates or dates. Each yes joins a
  waitlist, and everyone on it hears when you open the program.
- Once the program is open, it prepares each approval for you, welcomes approved affiliates
  with their link, and tracks who's earning.
- After each month closes, it prepares one payout per affiliate from the commissions owed
  and the invoices they rest on. You approve and pay each one, and only you can record it
  as paid.
- A payout and a terms change always go to you, however much trust the desk earns.
- Try it: "set up an affiliates desk" in a project with the kit.

### A watchdog for stalled work, and a GM that starts desks (PRD 16) · New
- `status` now has a "Stalled" list, with what fixes each item:
  - a desk with work for its agent, or a missed round, and nobody listening;
  - a brief past its due;
  - something stuck sending or uncertain;
  - work that went out alone a week ago and still isn't audited;
  - a headline nobody has measured for a week;
  - a check past its date.

  Each item goes away once it's fixed.
- With your yes, each desk gets a scheduled task in the Claude Code app, named on a `Start:`
  line in its `desk.md`. The GM starts a desk when it has work and nobody is listening, logs
  each start, and asks you instead if a desk it started still isn't listening an hour later.
- A desk opened while another chat is already listening to it says so and stops, rather than
  taking over.

### A GM desk runs the business towards money and runs the other desks (PRD 15) · New
- Say "set up a GM" and `new-desk` starts from the GM type. It asks for the money goal and
  target, what the GM may decide alone, a Stripe key (or test mode until there is one) and
  the desks it runs. It writes a first commercial plan from the repo, then does one round
  with you.
- Each round, the GM records revenue and reads every desk. It audits what went out alone,
  checks its bets and decides what the desks do next: at most three briefs, pauses for
  what's failing, and new initiatives. It ends with your brief: the money against the
  target, a line per desk, and numbered questions you answer "2 yes".
- It briefs; it doesn't do. The database refuses any other action on a GM's desk, keeps every
  initiative waiting for you, and closes a question only once your words are in the log.
- A bet runs only on a check with a baseline, and ends won or lost only as the check says.
- On every desk, a check now keeps its baseline once taken and what it measured once
  measured, and a verdict comes with the measurement it rests on. To look again, add a new
  check.
- Desk types: `desks/kit/types/` holds starting desks for `new-desk`, and a `Type:` line in
  `desk.md` says what kind a desk is. The GM is the first.

### A desk can read what the business earns from Stripe (PRD 14) · New
- `node desks/desk.mjs stripe revenue` gives charges minus refunds over the last 28 days
  (or `--days`), with fees and what's left after them, per currency. `stripe mrr` gives
  monthly recurring revenue, `stripe customers` new customers and how many paid, and
  `stripe failed` failed payments and invoices past due.
- `--record revenue-28d --desk gm` saves the figure in `measures`, with its window and
  whether it came from test or live mode, so it can be a desk's headline.
- `stripe <path> [name=value ...]` reads anything else, such as `stripe charges limit=3`;
  `--all` follows the pages.
- It only reads. It takes a restricted key or a test key, refuses a live secret key before
  calling Stripe, and never prints the key. `doctor` checks it.
- Making the key and what each figure counts: `desks/kit/playbooks/revenue.md`.

### Work that went out on its own gets checked, and a failed check takes trust away (PRD 13) · New
- Anyone who didn't do the work can audit it: something sent alone, a number a desk
  reported, a task it closed. The verdict is pass, fail or unsure, with notes and evidence
  someone can reopen.
- A failed audit of an action resets trust for that kind, as a rejection does, and the log
  says which audit did it. The desk shows its next ones to a person until it earns trust
  again.
- `audit_due` lists what went out alone in the last two weeks with no audit, with anything
  that bounced or drew a complaint first. `audit_findings` lists fails and unsures until a
  later audit says otherwise. `status` shows both.
- Nobody can audit their own work, and an audit never changes.
- How to choose what to check and write a verdict: `desks/kit/playbooks/audits.md`.

### A desk's agent works under its own name, and only a person gives it more room (PRD 12) · New
- Put `Agent: gm` in a desk's `desk.md` and run `init`. The agent then works with `--as gm`
  (or `DESK_AS=gm`), so the database can tell its work from the person's say-so.
- An agent can make things safer on its own: place holds, release its own, take back what
  was allowed, reset trust. Approving an action, letting work go alone, loosening trust and
  releasing someone else's hold need the person, in their own words.
- Trust that's loosened now records who said so and what they said, in the log.
- An agent gives another desk work with a brief, not a task. A task stays on its desk.
- What a person allowed and the holds placed now stay as written: to change one, revoke or
  release it and add a new one.
- `status` says who you are and lists each desk's agent; `doctor` says what an agent still
  needs. These guards stop mistakes; they aren't security.

### One desk can hand work to another with a brief (PRD 11) · New
- A desk writes a brief for another desk: the job, why it matters, and how both will know
  it's done. Once it's approved, `node desks/desk.mjs send <id>` delivers it as a task on
  that desk, and a chat listening to that desk wakes for it.
- Briefs earn trust like emails do: a person approves the first ones, then they go on
  their own, with every fifth shown in full.
- When the other desk finishes, drops or blocks the task, the desk that asked hears how
  it went in its log. `status` shows each desk's open briefs and the oldest one's age.
- How to write, take on and close one: `desks/kit/playbooks/briefs.md`.

### Numbers given to SQL behave the same on a local database as on a hosted one · Fixed
- `-a id=5` used to reach a local database as 5.0, so `'brief:' || :id` read `brief:5.0`
  and a number written to a text column was stored as `5.0`. Whole numbers now go in as
  integers, as they always did on a hosted database.

## 2026-10-30

### "/desk <name> listen" is understood straight away · Fixed
- The desk skill's description now says what listening is and lists "/desk <name> listen",
  "listen to the <name> desk" and "stop listening", and typing `/desk` hints at
  `[<desk>] [listen]`. Before, only the skill's body mentioned listening.

### A listening desk's chat hears its tasks and its schedule, not only mail (PRD 06) · New
- While a chat listens to a desk ("/desk <name> listen"), it's woken when one of the
  agent's tasks or checks comes due, and at the times in the desk's new `Round:` line
  (`Round: weekdays 09:00`), where it runs a round.
- It no longer wakes every 25 minutes just to start listening again: it waits as long as
  it takes.
- A chat that was closed catches up once when it listens again: one line per task, and one
  round that says how many were missed.
- Desks without a `Mail:` line can listen too, for tasks and rounds.
- `status` says who is listening to each desk, and when their listener last looked.
- Try it: add `Round:` to a desk's `desk.md` (`desks/kit/guide/anatomy.md`), then
  "/desk <name> listen".

### A claim that gets nothing now stops a send chained after it · Fixed
- `node desks/desk.mjs sql --expect-rows "UPDATE ... RETURNING id" && <send>` exits 1 when
  the claim gets no row back, so the send never runs. Before, "(no rows)" still exited 0,
  and `&&` only stopped on an outright refusal.
- `actions.md` shows the chain.

### A desk that already files its mail one way can listen without changing it · Improved
- A project with its own mail Worker, whose desks record mail as `acme-mail:<mailbox>:<id>`,
  sets `DESK_MAIL_PREFIX=acme-mail` and `watch`, `mail` and `send` use the same word, so
  mail that arrives while a desk listens matches the rows it already has.
- When the listener wakes such a desk, it reads and sends with the mail tool its own
  playbooks name, so the project's Worker only needs the one route the listener uses.
- Try it: "The contract, for a project with its own Worker" in `desks/kit/mail/README.md`.

## 2026-10-29

### Setting up desk mail is safer, and you can try it all on your machine (PRD 05) · Improved
- The mail Worker's local token and state stay out of git: the kit and `init` add them to
  `desks/.gitignore`, and `doctor` warns if the token file isn't ignored.
- Updating the kit never copies or deletes what wrangler and npm leave in its folders, and
  installing it no longer stops over unrelated uncommitted work in your project.
- The setup uses `npx wrangler@latest`, because an older wrangler can't run the Worker,
  and shows how to run it locally and deliver a test email to a desk.
- The kit's own `pnpm e2e` runs the whole loop against the real Worker on this machine:
  an email arrives, the desk wakes, the approved reply goes once, and a reply that's out of
  date is refused.
- Try it: "Running it locally" in `desks/kit/mail/README.md`.

### Desks read their mail and send approved replies with one command (PRD 04) · New
- `node desks/desk.mjs mail inbox --desk <name>` shows a desk the mail to its own
  addresses; `read`, `thread`, `search` and `sent` open the rest. Nothing in an email can
  drive your terminal.
- `node desks/desk.mjs send <id>` sends exactly the version you approved, once, and
  records what happened in the same step: sent, refused (in the Worker's words), or
  "might have gone", which is never sent again.
- Before it sends, it stops with nothing changed if the Worker wouldn't take the email
  (cap reached, never-contact list, wrong sender), if the person wrote again since, or if
  the subject would differ from the one you approved.
- Try it: approve a reply on a desk with a `Mail:` line, then `node desks/desk.mjs send <id>`.

### The kit ships a mail Worker for your desks (PRD 03) · New
- One Cloudflare Worker per project receives mail at the desks' own addresses, keeps and
  threads it, forwards you a copy, and sends the replies a desk has approved.
- Sends stay within daily and monthly caps, never go to an address on the never-contact
  list, and are never sent twice for the same action.
- Nothing to install: the Worker deploys with `wrangler` alone.
- Try it: `desks/kit/mail/README.md` has the setup, one step at a time.

### "/desk <name> listen" answers mail as it arrives (PRD 02) · New
- Say "/desk partners listen" and that session becomes the partners desk at work: it
  catches up, then answers each email to the desk's addresses as it lands, in the chat,
  where you can step in.
- Desks now read only their own addresses, never your inbox. Mail for another desk is
  handed over to it. A first touch sent from your own account BCCs the desk, so the reply
  comes back to the desk.
- New desks that talk by email get their own address, and you're asked before any
  Cloudflare change.

### Desks can listen for their own mail (PRD 01) · New
- Give a desk its own addresses with a `Mail:` line in its `desk.md`. Then
  `node desks/desk.mjs watch <desk>` waits for mail to those addresses, prints one line per
  email and exits, so the session that started it wakes up and answers.
- It never shows an email twice, picks up mail another desk handed over, and lets only one
  person listen to a desk at a time (`take listen:<desk>` hands it over).
- `doctor` checks that no two desks claim the same address and that the mail Worker answers.
- Try it: add `Mail:` to a desk, set `DESK_MAIL_URL` and `DESK_MAIL_TOKEN` in `desks/.env`,
  then run `node desks/desk.mjs watch <desk>`.
