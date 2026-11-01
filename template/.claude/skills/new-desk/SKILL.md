---
name: new-desk
description: Design and set up a new desk for a business in this project, in conversation. A desk is a standing piece of agent work (SEO, PPC, CRO, outreach, sales, admin, anything) with a one-page plan, its own tables and a shared, guarded database. Use for "set up a desk for X", "new desk", "make an agent desk for <business/goal>", "add an SEO/outreach/PPC desk", or changing what an existing desk is for. To work an existing desk, use desk.
---

# New desk

You design the desk with the person, then build it. There are no fixed packs. Work out
what this business needs from its purpose, its data and the examples, and keep it as
small as the work allows.

Read `desks/kit/guide/anatomy.md` first. It covers what a desk is made of, where it
lives, the plan format, table conventions, keys and the two families. Then read the
worked example nearest to this desk in `desks/kit/guide/examples/`.

If `desks/desk.mjs` doesn't exist in this project yet, install the kit first. From a
checkout of the agent-desk repo, run `node bin/kit.mjs <this project's root>`. If you're
in the agent-desk repo itself, ask which project the desk is for and work there.

## 1. Find the purpose

Ask one question at a time, and only what you can't find out yourself. Before asking,
look at the project: its README, apps, data, scripts, existing skills, `.env` names
(names only), and anything already in `desks/`.

- **What should be different in three months?** The outcome, in their words.
- **How will we know?** One headline number, where it's read, and a target. If there
  isn't a number yet, agree how one will be measured before building anything else.
- **What may the desk do, and as whom?** Which channels and identities. Which kinds of
  action. What always stays with a person (money, contracts, anything they reserve).
- **Who else works on it?** Just them on one machine (local file), or several people or
  machines (hosted, `desks/kit/playbooks/hosting.md`).
- **What's off limits?** People, brands, pages or topics it must not touch, and any caps
  on volume.

Don't import another desk's purpose, thresholds, facts or voice, even from the examples.
Don't assume the domain from the project's name.

## 2. Look at what's there

- **Data sources.** Skills and tools on this machine (`gcloud` for Search Console and
  Google Ads, `node desks/desk.mjs stripe` for revenue (`kit/playbooks/revenue.md`), mail
  tools, browser, platform APIs), scripts in the repo, and exports.
  Check each one the desk needs actually answers, read-only. Run one real query and note
  the shape of what comes back.
- **The things it works on.** Pages, brands, campaigns, people. What's their natural id
  and key (`page:/x`, `brand:acme`)? Do some already exist in the project's own database
  or CMS? Then read from there; don't copy it all into the desk.
- **Other desks in this project.** Share their people, contacts, holds and log; don't
  duplicate them.
- **Types.** `desks/kit/types/` holds starting desks with blanks to fill. `gm` is the desk
  that runs a business towards money and runs its other desks ("A GM" below). `affiliates`
  recruits, onboards and pays affiliates ("An affiliates desk" below). Start from a type when
  one fits; the desk you make from it is theirs to change.

## 3. Propose the desk

In plain words, in one message:

- the purpose and headline, with how it's measured;
- the family (conversation, change, or both) and the round, step by step, and when it
  runs: when someone asks, or on a schedule while a chat listens (`Round: weekdays 09:00`);
- each kind of action, as kind · channel · identity, and who approves it;
- its tables: one line each, what a row is and its stages;
- what it needs set up (env vars, access) and where it's stored;
- if it talks by email, its own address (see "Mail" below);
- the first real piece of work it would do.

Ask for the one decision that matters. Adjust, then build. Don't present a
questionnaire.

## 4. Build it

From a type, copy `desks/kit/types/<type>/` to `desks/<name>/` and fill every `<...>` blank
with what they told you, then check each step below against it.

1. `desks/<name>/desk.md`: the one-page plan in the anatomy format. Include the
   `Headline:`, `Target:` and `Needs:` lines, a `Mail:` line if it talks by email, a
   `Round:` line if its round runs on a schedule, an `Agent:` line if its agent will work
   without a person in the chat (a name no person uses, such as `gm`), and their own words
   for purpose and limits.
2. `desks/<name>/schema.sql`: only the desk's own things, named `<name>_<things>`. Each
   gets a key column, a stage with its values listed, `stage_at`, `source`, `last_by`
   and timestamps, plus the stage-change trigger. Add views for the questions the round
   asks every time. Use the core for everything it already has.
3. `desks/<name>/playbooks/`: only for steps the kit playbooks don't cover, such as how
   to read this data source or this platform's quirks. Point at existing skills and
   commands rather than restating them.
4. `node desks/desk.mjs init`, then `node desks/desk.mjs doctor`. Fix anything it reports.
5. If they want it hosted, follow `hosting.md`, and ask before creating the Railway
   service.
6. Make sure `desks/.env` has `DESK_USER`, and `.claude/skills/desk` exists.

### Mail

A desk that talks by email gets its own address, never the person's inbox: a persona or
role on a subdomain, such as `clara@partners.example.com`, listed in its `Mail:` line. An
address belongs to one desk. Mail to it goes to the project's mail Worker, which keeps
it, forwards a copy to the person and sends approved replies. The desk reads from the
Worker, and "/desk <name> listen" answers mail as it arrives.

If the project has no mail Worker yet, offer the kit's (`desks/kit/mail/README.md`), or
the one route the desk needs if the project already runs its own. Ask before any
Cloudflare change: the subdomain's DNS, routing, Email Sending, the database, secrets or
a deploy. Until it's set up, the desk can still be built; its mail steps wait. To try the
desk's mail first with nothing on Cloudflare, run the Worker on this machine (the README's
"Running it locally").

## A GM

A GM runs the business towards money and runs the other desks: `desks/kit/types/gm/desk.md`
says what it does. Its desk is `desks/gm`, copied from that type.

Set it up in the same conversation, one thing at a time:

- **The money goal and target.** What should be different, in their words, and the number:
  `revenue-28d`, or `mrr` for a subscription business, with a target and a date.
- **The mandate** (`mandate.md`): what it may decide alone, its budget (0 unless they set
  one), and what always stays with them. Read them the always-human list and ask what to add.
- **Stripe.** A restricted read key in `desks/.env`, written by them (`revenue.md`). With no
  key yet, a test key (`rk_test_` or `sk_test_`) lets the GM run on test data until there is
  one; say its numbers aren't the business's.
- **The desks it runs.** The desks in this project it may brief, a line each in
  `mandate.md`. A desk it should run but that doesn't exist yet is an initiative for later,
  not something to build now.
- **A first `plan.md`**, written from what's in the repo: the pricing page and Stripe prices,
  the docs, where analytics and sign-ups are read. Leave a blank where you can't find a
  source, and say so.

- **Sessions**, if they'd like the GM to start desks: ask, and with their yes set up the
  tasks by `playbooks/sessions.md`. Without it, the GM asks them to open desks instead.

Then `init`, `doctor`, and one round with them (`playbooks/round.md`), ending with their
first brief. Its questions are how you check the mandate is right.

## An affiliates desk

An affiliates desk finds people who'd recommend the product, asks them to be affiliates,
onboards them and prepares their payouts: `desks/kit/types/affiliates/desk.md` says what it
does. Its desk is `desks/affiliates`, copied from that type. It works before the program
exists, collecting interest, and after, running it.

Set it up in the same conversation, one thing at a time:

- **Is there a program yet?** If the product has one (the starter's affiliate pages, or
  another), where applications, affiliates and commissions are read, read-only, and the
  token's name in `Needs:`. If not, the desk starts by collecting interest, and needs nothing
  to read yet.
- **The terms**, only if they've set them: into `facts.md` in their words, with the date.
  Otherwise `facts.md` stays as it comes, the program starting and no numbers. Never suggest
  terms for them to accept.
- **Who makes a good affiliate** (`icp.md`): the kinds of people, the signs they fit, who not
  to ask, and where to look. Ask what they've seen work.
- **Its address.** Its own, on a subdomain (see "Mail" above), never their inbox.
- **Payouts**: how they pay (bank, PayPal, Wise) and from which account, for the payout
  row in `desk.md`. A payout and a terms change are always theirs; the database keeps them so.
- **Limits**: first touches a day, and the wait before the one follow-up.

Then `init`, `doctor`, and one round with them: find three people who fit, and show the first
touches for them to change.

## 5. Do one real round

Prove it on real work, in the open:

- record the headline's current value from its real source;
- load the first real things from the data sources;
- prepare the first actions for review, or the first changes with baselines;
- show them in full.

Ship nothing without their approval: a new desk starts with every kind of action in the
"their words" stage (`actions.md`). Then close the round as the `desk` skill does, and
tell them how to start the next one ("/desk", or "run the <name> desk"), and that
"/desk <name> listen" keeps a chat working it: mail, due tasks and its scheduled rounds.

## Changing a desk later

Edit `desk.md` for plan changes, and log the decision with their words. Table changes go
in `migrations/`, never as edits to an existing `CREATE TABLE`. Changes to views and
triggers in `schema.sql` take effect on the next `init`.
