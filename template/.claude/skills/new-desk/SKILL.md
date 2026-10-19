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
  Google Ads, mail tools, browser, platform APIs), scripts in the repo, and exports.
  Check each one the desk needs actually answers, read-only. Run one real query and note
  the shape of what comes back.
- **The things it works on.** Pages, brands, campaigns, people. What's their natural id
  and key (`page:/x`, `brand:acme`)? Do some already exist in the project's own database
  or CMS? Then read from there; don't copy it all into the desk.
- **Other desks in this project.** Share their people, contacts, holds and log; don't
  duplicate them.

## 3. Propose the desk

In plain words, in one message:

- the purpose and headline, with how it's measured;
- the family (conversation, change, or both) and the round, step by step;
- each kind of action, as kind · channel · identity, and who approves it;
- its tables: one line each, what a row is and its stages;
- what it needs set up (env vars, access) and where it's stored;
- the first real piece of work it would do.

Ask for the one decision that matters. Adjust, then build. Don't present a
questionnaire.

## 4. Build it

1. `desks/<name>/desk.md`: the one-page plan in the anatomy format. Include the
   `Headline:`, `Target:` and `Needs:` lines, and their own words for purpose and limits.
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

## 5. Do one real round

Prove it on real work, in the open:

- record the headline's current value from its real source;
- load the first real things from the data sources;
- prepare the first actions for review, or the first changes with baselines;
- show them in full.

Ship nothing without their approval: a new desk starts with every kind of action in the
"their words" stage (`actions.md`). Then close the round as the `desk` skill does, and
tell them how to start the next one ("/desk", or "run the <name> desk").

## Changing a desk later

Edit `desk.md` for plan changes, and log the decision with their words. Table changes go
in `migrations/`, never as edits to an existing `CREATE TABLE`. Changes to views and
triggers in `schema.sql` take effect on the next `init`.
