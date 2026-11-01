-- The desk core: tables every desk shares. One database per project or business.
-- Every desk in it (seo, outreach, ...) uses these, plus its own tables from
-- desks/<name>/schema.sql, named <name>_<thing> (seo_pages, outreach_brands).
--
-- Times are UTC ISO 8601 (2026-10-17T11:18:20.865Z); dates are YYYY-MM-DD.
-- Things are named by keys, the same way everywhere:
--   brand:acme  page:/stores/nike  email:jo@acme.com  domain:acme.com  person:jo-bloggs
--
-- The database does the guarding. Triggers below refuse: a send that isn't approved
-- or trusted, an approval of a version nobody saw, a send while someone else holds the
-- lock or a hold applies, a rewrite of anything already attempted, and any edit of the
-- log. When one refuses, read the message and do what it says; don't work around it.
--
-- `node desks/desk.mjs init` runs this file every time: tables are created once,
-- views and triggers are rebuilt so a kit update takes effect.

-- Every desk in this database.
CREATE TABLE IF NOT EXISTS desks (
  name TEXT PRIMARY KEY,                -- seo, outreach: the folder desks/<name>/
  title TEXT NOT NULL,
  headline TEXT,                        -- the measures.name that says it's working
  target TEXT,                          -- in words: "4,000 clicks a week by March"
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- The agents that work desks under their own names (desk.md's Agent: line, recorded by init).
-- A name here is an agent everywhere in this database; any other name is a person.
CREATE TABLE IF NOT EXISTS agents (
  name TEXT NOT NULL,                   -- gm: what --as and DESK_AS say
  desk TEXT NOT NULL REFERENCES desks(name),
  for_whom TEXT NOT NULL,               -- the person who ran init: doug
  at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (name, desk)
);

-- Schema files applied by init.
CREATE TABLE IF NOT EXISTS migrations (
  name TEXT PRIMARY KEY,                -- core/002-x.sql, seo/schema.sql
  checksum TEXT NOT NULL,
  applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  by TEXT NOT NULL
);

-- Anything that goes out into the world or changes it: an email, a LinkedIn message,
-- a page change, a bid change. Saved exactly as it will go, before it goes.
CREATE TABLE IF NOT EXISTS actions (
  id INTEGER PRIMARY KEY,
  desk TEXT NOT NULL REFERENCES desks(name),
  key TEXT NOT NULL UNIQUE,             -- source + intent, stable: reply:gmail:18c2f, title:/stores/nike:2026-10
  kind TEXT NOT NULL,                   -- email-reply, first-touch, title-change: each kind earns trust separately
  channel TEXT NOT NULL,                -- email, linkedin, site, google-ads
  identity TEXT NOT NULL,               -- what it acts as: doug@partners.example.com, example-shop.com
  about TEXT,                           -- the thing it concerns, as a key: brand:acme, page:/stores/nike
  target TEXT NOT NULL,                 -- exact recipient or object, as a key: email:jo@acme.com, page:/stores/nike
  title TEXT NOT NULL,                  -- subject line, or one line saying what changes
  body TEXT NOT NULL DEFAULT '',        -- the full text, or the change, exactly as it will go
  payload TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(payload)),   -- cc, bcc, thread, files with hashes, fields
  evidence TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(evidence)), -- what it rests on: refs that can be reopened
  first_title TEXT, first_body TEXT, first_payload TEXT,           -- the original, kept by the database
  version INTEGER NOT NULL DEFAULT 1,   -- the database bumps this when the content changes
  stage TEXT NOT NULL DEFAULT 'drafted' CHECK(stage IN ('coached','drafted')), -- set by the database
  status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN
    ('draft','waiting','approved','sending','sent','verified','failed','uncertain','rejected','dropped')),
  why_human TEXT,                       -- every reason it waits for a person, in plain words
  edited INTEGER NOT NULL DEFAULT 0 CHECK(edited IN (0,1)),        -- changed after a person saw it
  spot_check INTEGER NOT NULL DEFAULT 0 CHECK(spot_check IN (0,1)),
  mode TEXT CHECK(mode IN ('human','auto')),                         -- how it was sent
  trust_epoch INTEGER,
  approved_version INTEGER, approved_by TEXT, approved_at TEXT, approval_words TEXT,
  sent_by TEXT, sent_at TEXT, provider_ref TEXT,
  verified_at TEXT, verify_ref TEXT,
  result TEXT,                          -- what actually happened, in words
  trust_counted_at TEXT,
  created_by TEXT NOT NULL,
  last_by TEXT,                         -- who made the latest change; set it on every update
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- How well the desk has learnt each kind of action, per channel and identity.
-- Learnt quality only: going out on its own also needs a current row in `allowed`.
CREATE TABLE IF NOT EXISTS trust (
  desk TEXT NOT NULL, kind TEXT NOT NULL, channel TEXT NOT NULL, identity TEXT NOT NULL,
  coached INTEGER NOT NULL DEFAULT 0,       -- examples written from the person's own words
  coach_needed INTEGER NOT NULL DEFAULT 2,  -- 0 when they said "just write it"
  clean INTEGER NOT NULL DEFAULT 0,         -- drafts approved unchanged and verified, in a row
  needed INTEGER NOT NULL DEFAULT 5,
  trusted INTEGER NOT NULL DEFAULT 0 CHECK(trusted IN (0,1)),
  always_human INTEGER NOT NULL DEFAULT 0 CHECK(always_human IN (0,1)), -- money, contracts: never on its own
  since_check INTEGER NOT NULL DEFAULT 0,   -- automatic sends since a person last reviewed one
  check_every INTEGER NOT NULL DEFAULT 5,   -- every 5th is shown in full
  epoch INTEGER NOT NULL DEFAULT 0,         -- goes up on every edit or rejection
  note TEXT,                                -- what the person said when they last changed it
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (desk, kind, channel, identity)
);

-- What a person has allowed to go out without asking each time.
CREATE TABLE IF NOT EXISTS allowed (
  id INTEGER PRIMARY KEY,
  desk TEXT NOT NULL REFERENCES desks(name),
  kind TEXT NOT NULL, channel TEXT NOT NULL, identity TEXT NOT NULL,
  scope TEXT NOT NULL DEFAULT '',       -- limits and exclusions, in words
  words TEXT NOT NULL,                  -- what they actually said
  by TEXT NOT NULL,
  at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  expires_at TEXT, revoked_at TEXT, revoked_by TEXT
);

-- Who is working on what. One row per thing; the key is the thing's key.
CREATE TABLE IF NOT EXISTS locks (
  key TEXT PRIMARY KEY,                 -- brand:acme, page:/stores/nike, action:42
  by TEXT NOT NULL,
  desk TEXT,
  doing TEXT NOT NULL CHECK(doing <> ''),
  at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- Things not to do. Do-not-contact is a hold on email:x, domain:x or person:x with topic all.
CREATE TABLE IF NOT EXISTS holds (
  id INTEGER PRIMARY KEY,
  desk TEXT,                            -- NULL: every desk in this database
  about TEXT NOT NULL,                  -- a key, or * for everything the desk does
  topic TEXT NOT NULL DEFAULT 'all',    -- all, or one action kind
  reason TEXT NOT NULL,
  source TEXT,
  until TEXT,                           -- YYYY-MM-DD; NULL until released
  by TEXT NOT NULL,
  at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  released_at TEXT, released_by TEXT, release_reason TEXT
);

-- Promises and work with an owner and a date.
CREATE TABLE IF NOT EXISTS tasks (
  id INTEGER PRIMARY KEY,
  desk TEXT NOT NULL REFERENCES desks(name),
  what TEXT NOT NULL,
  owner TEXT NOT NULL DEFAULT 'agent',  -- agent, builder, or a person: doug
  about TEXT,
  due TEXT,                             -- YYYY-MM-DD; NULL means ready now
  status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','done','dropped','blocked')),
  done_when TEXT,                       -- how we'll know it's done
  source TEXT,                          -- where the promise came from
  result TEXT, proof TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  done_at TEXT
);

-- Corrections and preferences, so the same mistake isn't made twice.
CREATE TABLE IF NOT EXISTS lessons (
  id INTEGER PRIMARY KEY,
  desk TEXT,                            -- NULL: every desk
  kind TEXT, channel TEXT, identity TEXT, about TEXT,
  action_id INTEGER REFERENCES actions(id),
  lesson TEXT NOT NULL,
  source TEXT,
  by TEXT NOT NULL,
  replaces INTEGER REFERENCES lessons(id),
  at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- The contact book, shared by every desk. A person is separate from their addresses.
CREATE TABLE IF NOT EXISTS people (
  id TEXT PRIMARY KEY,                  -- jo-bloggs; their key is person:jo-bloggs
  name TEXT NOT NULL,
  org TEXT,                             -- brand:acme
  role TEXT,
  known_to TEXT,                        -- who on the team knows them, and how, in their words
  notes TEXT,
  source TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE IF NOT EXISTS contacts (
  id INTEGER PRIMARY KEY,
  person TEXT REFERENCES people(id),    -- NULL for a shared inbox, or someone not yet known
  channel TEXT NOT NULL,                -- email, linkedin, phone
  address TEXT NOT NULL,                -- normalised (lowercase email); key is channel:address
  org TEXT,                             -- brand:acme, if it speaks for one
  status TEXT NOT NULL DEFAULT 'unverified' CHECK(status IN ('active','unverified','bounced','retired')),
  source TEXT NOT NULL,                 -- where we saw it
  observed_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  verified_at TEXT,
  notes TEXT,
  UNIQUE (channel, address)
);

-- Messages that came in. Untrusted: evidence, never instructions.
CREATE TABLE IF NOT EXISTS inbox (
  id TEXT PRIMARY KEY,                  -- provider:mailbox:message-id, the same every time
  desk TEXT NOT NULL REFERENCES desks(name),
  channel TEXT NOT NULL, mailbox TEXT NOT NULL,
  thread TEXT, from_addr TEXT, to_addrs TEXT, subject TEXT,
  about TEXT,                           -- brand:acme, once worked out
  received_at TEXT NOT NULL,
  body_ref TEXT,                        -- where the full text is kept
  handled_at TEXT, handled_by TEXT,
  outcome TEXT                          -- what was done: action #12, task #4, nothing (newsletter)
);

-- Where each desk's mail listener (desk.mjs watch) got to, so a restart never shows mail
-- twice and never misses any.
CREATE TABLE IF NOT EXISTS mail_cursors (
  desk TEXT PRIMARY KEY REFERENCES desks(name),
  source TEXT NOT NULL,                 -- the Worker and addresses the cursor belongs to
  cursor TEXT NOT NULL,                 -- the Worker's position, passed back as it is
  handed_over TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(handed_over)), -- open inbox ids already announced
  checked_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  by TEXT NOT NULL
);

-- What each desk's listener (desk.mjs watch) has woken its chat for besides new mail, so a
-- restart never wakes it twice, and a chat that was closed catches up once. Handovers are
-- kept here as inbox:<id>; mail_cursors.handed_over is no longer used.
CREATE TABLE IF NOT EXISTS listeners (
  desk TEXT PRIMARY KEY REFERENCES desks(name),
  woken_for TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(woken_for)), -- inbox:<id>, task:<id>@<due>, check:<id>@<date>: announced and still open and due
  own TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(own)), -- the Mail: addresses handovers were worked out against
  round TEXT,                           -- the Round: line round_at was worked out from
  round_at TEXT,                        -- the latest scheduled round announced (or skipped at the start)
  run TEXT,                             -- the watch listening now: a newer one takes over, and this one stops
  checked_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')), -- when the listener last looked
  by TEXT NOT NULL
);

-- A change, measured later: where it stood before, when to look again, what happened.
CREATE TABLE IF NOT EXISTS checks (
  id INTEGER PRIMARY KEY,
  desk TEXT NOT NULL REFERENCES desks(name),
  action_id INTEGER REFERENCES actions(id),
  about TEXT NOT NULL,
  metric TEXT NOT NULL,                 -- clicks, ctr, position, conversion-rate
  baseline REAL, baseline_from TEXT, baseline_to TEXT,
  check_at TEXT NOT NULL,               -- YYYY-MM-DD
  value REAL, value_from TEXT, value_to TEXT,
  verdict TEXT CHECK(verdict IN ('better','worse','flat','unclear')),
  notes TEXT, source TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  measured_at TEXT, measured_by TEXT
);

-- Numbers over time: the headline and anything else worth tracking.
CREATE TABLE IF NOT EXISTS measures (
  id INTEGER PRIMARY KEY,
  desk TEXT NOT NULL REFERENCES desks(name),
  name TEXT NOT NULL,                   -- clicks-7d, replies-week
  value REAL NOT NULL,
  unit TEXT,
  period_from TEXT, period_to TEXT,
  source TEXT NOT NULL,                 -- where it was read
  by TEXT NOT NULL,
  observed_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- What happened, in order. Append only: correct a mistake with a new row.
CREATE TABLE IF NOT EXISTS log (
  id INTEGER PRIMARY KEY,
  at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  desk TEXT,
  by TEXT NOT NULL,                     -- a person (doug), or a person's agent
  kind TEXT NOT NULL CHECK(kind IN ('note','decision','status','in','out','sent','verified',
    'failed','uncertain','takeover','measured','trust')),
  about TEXT,
  action_id INTEGER REFERENCES actions(id),
  summary TEXT NOT NULL,
  ref TEXT,                             -- provider id, URL, file
  details TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(details))
);

-- A check of a desk's work by someone who didn't do it: something that went out on its own,
-- a number it reported, a task it closed. Append only, like the log. A fail on an action
-- starts trust for its kind again.
CREATE TABLE IF NOT EXISTS audits (
  id INTEGER PRIMARY KEY,
  desk TEXT NOT NULL REFERENCES desks(name),  -- the desk whose work was checked
  checked TEXT NOT NULL,                      -- action:<id>, measure:<id> or task:<id>
  verdict TEXT NOT NULL CHECK(verdict IN ('pass','fail','unsure')),
  notes TEXT NOT NULL,                        -- what was checked, and what was found
  evidence TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(evidence)), -- refs someone could reopen
  by TEXT NOT NULL,
  at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE INDEX IF NOT EXISTS actions_queue ON actions(desk, status);
CREATE INDEX IF NOT EXISTS actions_about ON actions(about);
CREATE INDEX IF NOT EXISTS log_desk ON log(desk, at);
CREATE INDEX IF NOT EXISTS log_about ON log(about, at);
CREATE INDEX IF NOT EXISTS tasks_due ON tasks(desk, status, due);
CREATE INDEX IF NOT EXISTS tasks_source ON tasks(source);
CREATE INDEX IF NOT EXISTS actions_briefs ON actions(target) WHERE channel = 'desk';
CREATE INDEX IF NOT EXISTS checks_due ON checks(desk, measured_at, check_at);
CREATE INDEX IF NOT EXISTS holds_about ON holds(about);
CREATE INDEX IF NOT EXISTS contacts_person ON contacts(person);
CREATE INDEX IF NOT EXISTS inbox_open ON inbox(desk, handled_at);
CREATE INDEX IF NOT EXISTS measures_name ON measures(desk, name, observed_at);
CREATE INDEX IF NOT EXISTS audits_checked ON audits(checked);

-- Views and triggers hold no data, so they are rebuilt on every init.

DROP VIEW IF EXISTS active_holds;
CREATE VIEW active_holds AS
  SELECT * FROM holds WHERE released_at IS NULL AND (until IS NULL OR until >= date('now'));

DROP VIEW IF EXISTS active_allowed;
CREATE VIEW active_allowed AS
  SELECT * FROM allowed WHERE revoked_at IS NULL
    AND (expires_at IS NULL OR expires_at > strftime('%Y-%m-%dT%H:%M:%fZ','now'));

-- Every key an action touches: what it's about, each recipient, everything it covers
-- (payload.covers, for one email on behalf of several brands), their email domains and
-- the people behind the addresses. Holds and locks are checked against all of them.
-- Email and domain keys are compared in lowercase.
DROP VIEW IF EXISTS action_keys;
CREATE VIEW action_keys AS
  SELECT id AS action_id, CASE WHEN about LIKE 'email:%' OR about LIKE 'domain:%' THEN lower(about)
    ELSE about END AS key FROM actions WHERE about IS NOT NULL
  UNION SELECT id, CASE WHEN target LIKE 'email:%' OR target LIKE 'domain:%' THEN lower(target)
    ELSE target END FROM actions
  UNION SELECT a.id, a.channel || ':' || lower(j.value) FROM actions a, json_each(a.payload, '$.cc') j
  UNION SELECT a.id, a.channel || ':' || lower(j.value) FROM actions a, json_each(a.payload, '$.bcc') j
  UNION SELECT a.id, CASE WHEN j.value LIKE 'email:%' OR j.value LIKE 'domain:%' THEN lower(j.value)
    ELSE j.value END FROM actions a, json_each(a.payload, '$.covers') j;
DROP VIEW IF EXISTS action_touches;
CREATE VIEW action_touches AS
  SELECT action_id, key FROM action_keys
  UNION SELECT action_id, 'domain:' || lower(substr(key, instr(key, '@') + 1))
    FROM action_keys WHERE key LIKE 'email:%@%'
  UNION SELECT k.action_id, 'person:' || c.person
    FROM action_keys k JOIN contacts c ON c.channel || ':' || lower(c.address) = k.key
    WHERE c.person IS NOT NULL;

-- Each hold's key in the same form as action_keys, and those of the holds in force.
DROP VIEW IF EXISTS hold_keys;
CREATE VIEW hold_keys AS
  SELECT id, desk, topic, at, CASE WHEN about LIKE 'email:%' OR about LIKE 'domain:%' THEN lower(about)
    ELSE about END AS key FROM holds;
DROP VIEW IF EXISTS active_hold_keys;
CREATE VIEW active_hold_keys AS
  SELECT k.id, k.desk, k.topic, k.key FROM hold_keys k JOIN active_holds h ON h.id = k.id;

-- Waiting for a person to say send, change or drop.
DROP VIEW IF EXISTS waiting;
CREATE VIEW waiting AS
  SELECT a.desk, a.id, a.kind, a.about, a.target, a.title, a.version, a.stage, a.edited,
    a.spot_check, a.why_human, a.created_by, a.created_at, l.by AS locked_by
  FROM actions a LEFT JOIN locks l ON l.key = a.about
  WHERE a.status = 'waiting';

-- Approved but not sent, sent but not verified, or unknown. A 'sending' row more than a
-- few minutes old means a send may have happened: check the provider before anything else.
DROP VIEW IF EXISTS in_flight;
CREATE VIEW in_flight AS
  SELECT desk, id, kind, about, target, title, status, mode, approved_by, sent_by, sent_at,
    provider_ref,
    round((julianday('now') - julianday(coalesce(sent_at, approved_at, updated_at))) * 24, 1) AS hours
  FROM actions WHERE status IN ('approved','sending','sent','uncertain');

-- Due now: open tasks and changes ready to be measured.
DROP VIEW IF EXISTS due;
CREATE VIEW due AS
  SELECT desk, 'task' AS type, id, owner, about, what, due FROM tasks
    WHERE status = 'open' AND (due IS NULL OR due <= date('now'))
  UNION ALL
  SELECT desk, 'check', id, 'agent', about,
    'measure ' || metric || coalesce(' after action #' || action_id, ''), check_at FROM checks
    WHERE measured_at IS NULL AND check_at <= date('now');

-- What's wrong with a brief, if anything. brief_written and brief_edited refuse on these.
DROP VIEW IF EXISTS brief_faults;
CREATE VIEW brief_faults AS
  SELECT a.id,
    a.target NOT LIKE 'desk:%' OR substr(a.target, 6) = a.desk
      OR NOT EXISTS (SELECT 1 FROM desks d WHERE d.name = substr(a.target, 6)) AS bad_target,
    trim(coalesce(json_extract(a.payload, '$.done_when'), '')) = '' AS no_done_when,
    coalesce(json_extract(a.payload, '$.owner'), 'agent') NOT IN ('agent','builder') AS bad_owner,
    json_extract(a.payload, '$.due') IS NOT NULL
      AND date(json_extract(a.payload, '$.due')) IS NOT json_extract(a.payload, '$.due') AS bad_due
  FROM actions a WHERE a.channel = 'desk';

-- Work one desk gave another (channel desk), and how the task it became is going.
DROP VIEW IF EXISTS briefs;
CREATE VIEW briefs AS
  SELECT a.desk AS from_desk, substr(a.target, 6) AS to_desk, a.id AS action_id, a.kind, a.title,
    a.status AS brief_status, t.id AS task_id, t.status AS task_status, t.owner, t.due, t.result,
    t.proof, a.created_at, t.done_at,
    round(julianday(coalesce(t.done_at, 'now')) - julianday(coalesce(a.sent_at, a.created_at)), 1) AS days,
    a.about
  FROM actions a LEFT JOIN tasks t ON t.source = 'brief:' || a.id
  WHERE a.channel = 'desk';

-- Who holds what, and for how long.
DROP VIEW IF EXISTS held;
CREATE VIEW held AS
  SELECT key, by, desk, doing, at, round((julianday('now') - julianday(at)) * 24, 1) AS hours
  FROM locks;

-- Conversations where we spoke last.
DROP VIEW IF EXISTS waiting_on_them;
CREATE VIEW waiting_on_them AS
  SELECT desk, about,
    max(CASE WHEN kind = 'out' THEN at END) AS last_out,
    max(CASE WHEN kind = 'in' THEN at END) AS last_in,
    sum(CASE WHEN kind = 'out' THEN 1 ELSE 0 END) AS sent
  FROM log WHERE about IS NOT NULL AND kind IN ('in','out')
  GROUP BY desk, about
  HAVING last_out IS NOT NULL AND (last_in IS NULL OR last_out > last_in);

-- Sends today, for daily limits.
DROP VIEW IF EXISTS sent_today;
CREATE VIEW sent_today AS
  SELECT desk, kind, channel, identity, mode, count(*) AS attempts FROM actions
  WHERE sent_at >= date('now') GROUP BY desk, kind, channel, identity, mode;

-- The latest value of each measure, with the one before it.
DROP VIEW IF EXISTS headline;
CREATE VIEW headline AS
  SELECT m.desk, m.name, m.value, m.unit, m.period_from, m.period_to, m.observed_at, m.source,
    (SELECT p.value FROM measures p WHERE p.desk = m.desk AND p.name = m.name
       AND p.observed_at < m.observed_at ORDER BY p.observed_at DESC LIMIT 1) AS previous
  FROM measures m
  WHERE m.id = (SELECT x.id FROM measures x WHERE x.desk = m.desk AND x.name = m.name
                ORDER BY x.observed_at DESC, x.id DESC LIMIT 1);

-- One line per desk: the same shape in every database.
DROP VIEW IF EXISTS board;
CREATE VIEW board AS
  SELECT d.name AS desk, d.title,
    (SELECT count(*) FROM actions a WHERE a.desk = d.name AND a.status = 'waiting') AS waiting,
    (SELECT count(*) FROM due x WHERE x.desk = d.name) AS due,
    (SELECT count(*) FROM actions a WHERE a.desk = d.name AND a.status IN ('approved','sending','sent')) AS in_flight,
    (SELECT count(*) FROM actions a WHERE a.desk = d.name AND a.status = 'uncertain') AS uncertain,
    (SELECT count(*) FROM locks l WHERE l.desk = d.name) AS locks,
    d.headline,
    (SELECT h.value FROM headline h WHERE h.desk = d.name AND h.name = d.headline) AS value,
    (SELECT h.previous FROM headline h WHERE h.desk = d.name AND h.name = d.headline) AS previous,
    d.target,
    (SELECT max(g.at) FROM log g WHERE g.desk = d.name) AS last_activity
  FROM desks d;

-- Who is listening to each desk (desk.mjs watch holds listen:<desk>), and when its listener
-- last looked. A desk nobody has listened to has no row.
DROP VIEW IF EXISTS listening;
CREATE VIEW listening AS
  SELECT d.name AS desk, k.by, k.at AS since,
    nullif(max(coalesce(n.checked_at, ''), coalesce(c.checked_at, '')), '') AS looked_at
  FROM desks d
  LEFT JOIN locks k ON k.key = 'listen:' || d.name
  LEFT JOIN listeners n ON n.desk = d.name
  LEFT JOIN mail_cursors c ON c.desk = d.name
  WHERE k.key IS NOT NULL OR n.desk IS NOT NULL OR c.desk IS NOT NULL;

-- Trust in words.
DROP VIEW IF EXISTS trust_board;
CREATE VIEW trust_board AS
  SELECT desk, kind, channel, identity,
    CASE WHEN always_human = 1 THEN 'always a person'
         WHEN coached < coach_needed THEN 'learning their words (' || coached || '/' || coach_needed || ')'
         WHEN trusted = 1 THEN 'trusted (spot check after ' || (check_every - 1 - since_check) || ' more)'
         ELSE 'drafts for review (' || clean || '/' || needed || ' clean)' END AS stage,
    epoch, updated_at
  FROM trust;

-- What went out on its own in the last 14 days with no audit yet. trouble counts holds
-- placed since on anything it touched: a bounce, a complaint or an opt-out becomes a hold.
DROP VIEW IF EXISTS audit_due;
DROP VIEW IF EXISTS went_alone;
-- Everything that went out on its own, with its latest audit, if any. The GM's brief to the
-- person reads what's new since the last one: WHERE sent_at > <the last brief's time>.
CREATE VIEW went_alone AS
  SELECT a.desk, a.id, a.kind, a.channel, a.identity, a.target, a.title, a.status, a.sent_at,
    u.verdict AS audit, u.id AS audit_id, u.by AS audited_by
  FROM actions a
  LEFT JOIN audits u ON u.id = (SELECT max(v.id) FROM audits v WHERE v.checked = 'action:' || a.id)
  WHERE a.mode = 'auto' AND a.status IN ('sent','verified','uncertain');
CREATE VIEW audit_due AS
  SELECT w.desk, w.id, w.kind, w.channel, w.identity, w.target, w.title, w.status, w.sent_at,
    (SELECT count(*) FROM hold_keys h WHERE h.at >= w.sent_at
      AND h.key IN (SELECT key FROM action_touches t WHERE t.action_id = w.id)) AS trouble
  FROM went_alone w
  WHERE w.audit_id IS NULL AND w.sent_at >= strftime('%Y-%m-%dT%H:%M:%fZ','now','-14 days');

-- Audits that failed or weren't sure, until a later audit of the same thing says otherwise.
-- The GM's brief to the person carries these.
DROP VIEW IF EXISTS audit_findings;
CREATE VIEW audit_findings AS
  SELECT u.desk, u.id, u.checked, u.verdict, u.notes, u.evidence, u.by, u.at
  FROM audits u
  WHERE u.verdict IN ('fail','unsure')
    AND NOT EXISTS (SELECT 1 FROM audits v WHERE v.checked = u.checked AND v.id > u.id);

-- The work an audit can check, and who made it: audit_written reads this.
DROP VIEW IF EXISTS audited_work;
CREATE VIEW audited_work AS
  SELECT 'action:' || id AS checked, id, desk, created_by AS by FROM actions
  UNION ALL SELECT 'action:' || id, id, desk, sent_by FROM actions WHERE sent_by IS NOT NULL
  UNION ALL SELECT 'measure:' || id, id, desk, by FROM measures
  UNION ALL SELECT 'task:' || id, id, desk, created_by FROM tasks;

-- Desks nobody is listening to: no listener, or one that hasn't looked for 15 minutes. fix
-- says what to do: start the desk, or, if the GM started it in the last hour (a log note about
-- desk:<name> with ref scheduled-task:<id>) and it still isn't listening, ask the person.
DROP VIEW IF EXISTS watchdog;
DROP VIEW IF EXISTS unheard;
CREATE VIEW unheard AS
  SELECT d.name AS desk, d.created_at, l.by, l.looked_at, s.at AS started_at,
    CASE WHEN s.at >= strftime('%Y-%m-%dT%H:%M:%fZ','now','-1 hour')
      THEN 'started at ' || s.at || ' and still not listening: ask the person to open it (/desk ' || d.name || ' listen)'
      ELSE 'start it with its Start: task, or ask the person to open it (/desk ' || d.name || ' listen)' END AS fix
  FROM desks d
  LEFT JOIN listening l ON l.desk = d.name
  LEFT JOIN (SELECT about, max(at) AS at FROM log WHERE kind = 'note' AND ref GLOB 'scheduled-task:*' GROUP BY about) s
    ON s.about = 'desk:' || d.name
  WHERE NOT coalesce(l.by IS NOT NULL AND l.looked_at >= strftime('%Y-%m-%dT%H:%M:%fZ','now','-15 minutes'), 0);

-- What's stalled, one row per problem: the desk, what's wrong, since when, and what fixes it.
-- A row goes once its problem is fixed. The GM's round reads it first, and status shows it,
-- adding a round that came due with nobody listening (it reads the Round: lines).
CREATE VIEW watchdog AS
  SELECT u.desk, 'nobody listening' AS problem, 'desk:' || u.desk AS about,
    w.n || ' due for its agent, and nobody listening' AS what, coalesce(u.looked_at, w.since) AS since, u.fix
  FROM unheard u
  JOIN (SELECT desk, count(*) AS n, min(due) AS since FROM due WHERE owner = 'agent' GROUP BY desk) w
    ON w.desk = u.desk
  UNION ALL
  SELECT b.to_desk, 'brief overdue', 'brief:' || b.action_id,
    'brief #' || b.action_id || ' from ' || b.from_desk || ' (' || b.title || ') is still open'
      || CASE WHEN b.due IS NOT NULL THEN ', due ' || b.due ELSE ' after ' || cast(b.days AS INTEGER) || ' days' END,
    coalesce(b.due, b.created_at),
    'ask ' || b.to_desk || ' where it stands, then brief again or drop it'
  FROM briefs b
  WHERE b.task_status = 'open' AND (b.due < date('now') OR (b.due IS NULL AND b.days > 7))
  UNION ALL
  SELECT a.desk, CASE a.status WHEN 'sending' THEN 'stuck sending' ELSE 'uncertain' END, 'action:' || a.id,
    '#' || a.id || ' (' || a.kind || ') has been ' || a.status || ' since ' || a.updated_at, a.updated_at,
    'check the provider for what happened, then settle it; never send it again blind (kit/playbooks/actions.md)'
  FROM actions a
  WHERE (a.status = 'sending' AND a.updated_at < strftime('%Y-%m-%dT%H:%M:%fZ','now','-15 minutes'))
     OR (a.status = 'uncertain' AND a.updated_at < strftime('%Y-%m-%dT%H:%M:%fZ','now','-1 hour'))
  UNION ALL
  SELECT w.desk, 'audit overdue', 'action:' || w.id,
    '#' || w.id || ' (' || w.kind || ') went out alone ' || w.sent_at || ' and nobody has audited it', w.sent_at,
    'audit it, as someone who didn''t send it (kit/playbooks/audits.md)'
  FROM audit_due w
  WHERE w.sent_at < strftime('%Y-%m-%dT%H:%M:%fZ','now','-7 days')
  UNION ALL
  SELECT d.name, 'headline stale', 'headline:' || d.headline,
    d.headline || CASE WHEN h.observed_at IS NULL THEN ' has never been measured' ELSE ' was last measured ' || h.observed_at END,
    coalesce(h.observed_at, d.created_at),
    'measure ' || d.headline || ' from its source and record it in measures'
  FROM desks d LEFT JOIN headline h ON h.desk = d.name AND h.name = d.headline
  WHERE d.headline IS NOT NULL AND coalesce(h.observed_at, d.created_at) < strftime('%Y-%m-%dT%H:%M:%fZ','now','-7 days')
  UNION ALL
  SELECT c.desk, 'check overdue', 'check:' || c.id, 'check #' || c.id || ' on ' || c.metric || ' was due ' || c.check_at,
    c.check_at, 'measure it the way its baseline was taken (kit/playbooks/changes.md)'
  FROM checks c
  WHERE c.measured_at IS NULL AND c.check_at < date('now');

-- The log never changes.
DROP TRIGGER IF EXISTS log_no_update;
CREATE TRIGGER log_no_update BEFORE UPDATE ON log
BEGIN SELECT RAISE(ABORT, 'the log is never changed: add a new row that corrects it'); END;
DROP TRIGGER IF EXISTS log_no_delete;
CREATE TRIGGER log_no_delete BEFORE DELETE ON log
BEGIN SELECT RAISE(ABORT, 'the log is never deleted'); END;

-- Taking over someone's lock is recorded.
DROP TRIGGER IF EXISTS lock_takeover;
CREATE TRIGGER lock_takeover AFTER UPDATE OF by ON locks WHEN NEW.by IS NOT OLD.by
BEGIN
  INSERT INTO log(desk, by, kind, about, summary, details) VALUES (NEW.desk, NEW.by, 'takeover', NEW.key,
    NEW.by || ' took ' || NEW.key || ' from ' || OLD.by,
    json_object('was_doing', OLD.doing, 'since', OLD.at, 'now_doing', NEW.doing));
END;

-- A new action starts as a draft or waiting. The database keeps the original, opens its
-- trust counter and decides whether it is still a coached example.
DROP TRIGGER IF EXISTS action_insert_check;
CREATE TRIGGER action_insert_check BEFORE INSERT ON actions
BEGIN
  SELECT RAISE(ABORT, 'a new action starts as draft or waiting')
    WHERE NEW.status NOT IN ('draft','waiting');
  SELECT RAISE(ABORT, 'first_*, version, stage and approval fields are set by the database')
    WHERE NEW.first_payload IS NOT NULL OR NEW.version <> 1 OR NEW.approved_version IS NOT NULL
       OR NEW.mode IS NOT NULL OR NEW.trust_counted_at IS NOT NULL;
END;
DROP TRIGGER IF EXISTS action_insert;
CREATE TRIGGER action_insert AFTER INSERT ON actions
BEGIN
  INSERT OR IGNORE INTO trust(desk, kind, channel, identity, always_human)
    VALUES (NEW.desk, NEW.kind, NEW.channel, NEW.identity, NEW.channel = 'gm');
  UPDATE actions SET
    first_title = NEW.title, first_body = NEW.body, first_payload = NEW.payload,
    last_by = coalesce(NEW.last_by, NEW.created_by),
    stage = (SELECT CASE WHEN t.coached < t.coach_needed THEN 'coached' ELSE 'drafted' END FROM trust t
             WHERE t.desk = NEW.desk AND t.kind = NEW.kind AND t.channel = NEW.channel AND t.identity = NEW.identity),
    trust_epoch = (SELECT t.epoch FROM trust t
             WHERE t.desk = NEW.desk AND t.kind = NEW.kind AND t.channel = NEW.channel AND t.identity = NEW.identity)
  WHERE id = NEW.id;
  INSERT INTO log(desk, by, kind, about, action_id, summary)
    VALUES (NEW.desk, NEW.created_by, 'status', NEW.about, NEW.id,
      '#' || NEW.id || ' ' || NEW.kind || ' prepared (' || NEW.status || '): ' || NEW.title);
END;

-- What an action is never changes: make a new one instead.
DROP TRIGGER IF EXISTS action_fixed;
CREATE TRIGGER action_fixed BEFORE UPDATE OF desk, key, kind, channel, identity, created_by ON actions
WHEN NEW.desk IS NOT OLD.desk OR NEW.key IS NOT OLD.key OR NEW.kind IS NOT OLD.kind
  OR NEW.channel IS NOT OLD.channel OR NEW.identity IS NOT OLD.identity OR NEW.created_by IS NOT OLD.created_by
BEGIN SELECT RAISE(ABORT, 'desk, key, kind, channel and identity are fixed: drop this action and make a new one'); END;

DROP TRIGGER IF EXISTS action_original;
CREATE TRIGGER action_original BEFORE UPDATE OF first_title, first_body, first_payload ON actions
WHEN OLD.first_payload IS NOT NULL AND (NEW.first_title IS NOT OLD.first_title
  OR NEW.first_body IS NOT OLD.first_body OR NEW.first_payload IS NOT OLD.first_payload)
BEGIN SELECT RAISE(ABORT, 'the original version is kept as it was'); END;

-- Once attempted or closed, the content is what it was.
DROP TRIGGER IF EXISTS action_attempted;
CREATE TRIGGER action_attempted BEFORE UPDATE OF about, target, title, body, payload, evidence ON actions
WHEN OLD.status NOT IN ('draft','waiting','approved') AND (NEW.about IS NOT OLD.about
  OR NEW.target IS NOT OLD.target OR NEW.title IS NOT OLD.title OR NEW.body IS NOT OLD.body
  OR NEW.payload IS NOT OLD.payload OR NEW.evidence IS NOT OLD.evidence)
BEGIN SELECT RAISE(ABORT, 'this action was already attempted or closed, so its content cannot change'); END;

-- A content change makes a new version. Any approval is cleared; a change after a person
-- saw it counts as edited.
DROP TRIGGER IF EXISTS action_edit;
CREATE TRIGGER action_edit AFTER UPDATE OF about, target, title, body, payload ON actions
WHEN NEW.about IS NOT OLD.about OR NEW.target IS NOT OLD.target OR NEW.title IS NOT OLD.title
  OR NEW.body IS NOT OLD.body OR NEW.payload IS NOT OLD.payload
BEGIN
  UPDATE actions SET
    version = OLD.version + 1,
    approved_version = NULL, approved_by = NULL, approved_at = NULL, approval_words = NULL,
    status = CASE WHEN OLD.status = 'approved' THEN 'waiting' ELSE OLD.status END,
    edited = CASE WHEN OLD.status IN ('waiting','approved') THEN 1 ELSE OLD.edited END
  WHERE id = NEW.id;
END;

-- Only these moves are possible.
DROP TRIGGER IF EXISTS action_moves;
CREATE TRIGGER action_moves BEFORE UPDATE OF status ON actions WHEN NEW.status IS NOT OLD.status
BEGIN
  SELECT RAISE(ABORT, 'that status change is not allowed. The path is draft > waiting > approved > sending > sent > verified; sending or sent can end failed or uncertain; uncertain is settled by checking; waiting or approved can be rejected or dropped; verified, failed, rejected and dropped are final')
  WHERE (OLD.status || '>' || NEW.status) NOT IN (
    'draft>waiting', 'draft>sending', 'draft>dropped',
    'waiting>approved', 'waiting>rejected', 'waiting>dropped',
    'approved>waiting', 'approved>sending', 'approved>rejected', 'approved>dropped',
    'sending>sent', 'sending>verified', 'sending>failed', 'sending>uncertain',
    'sent>verified', 'sent>failed', 'sent>uncertain',
    'uncertain>sent', 'uncertain>verified', 'uncertain>failed');
END;

-- Two workers claiming the same send: the second one stops here.
DROP TRIGGER IF EXISTS action_claimed;
CREATE TRIGGER action_claimed BEFORE UPDATE OF status ON actions
WHEN NEW.status = 'sending' AND OLD.status = 'sending'
BEGIN SELECT RAISE(ABORT, 'already being sent: someone else got there first'); END;

-- Approval covers the exact version the person saw.
DROP TRIGGER IF EXISTS action_approve;
CREATE TRIGGER action_approve BEFORE UPDATE OF status ON actions
WHEN NEW.status = 'approved' AND OLD.status IS NOT 'approved'
BEGIN
  SELECT RAISE(ABORT, 'say who approved it: set approved_by') WHERE NEW.approved_by IS NULL;
  SELECT RAISE(ABORT, 'an agent can''t approve: approved_by is the person who said yes, and approval_words what they said')
    WHERE NEW.approved_by IN (SELECT name FROM agents);
  SELECT RAISE(ABORT, 'this changed since it was shown: show the current version and ask again')
    WHERE NEW.approved_version IS NOT OLD.version;
END;
DROP TRIGGER IF EXISTS action_approved;
CREATE TRIGGER action_approved AFTER UPDATE OF status ON actions
WHEN NEW.status = 'approved' AND OLD.status IS NOT 'approved'
BEGIN
  UPDATE actions SET
    approved_at = coalesce(NEW.approved_at, strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    trust_epoch = (SELECT t.epoch FROM trust t WHERE t.desk = NEW.desk AND t.kind = NEW.kind
                   AND t.channel = NEW.channel AND t.identity = NEW.identity)
  WHERE id = NEW.id;
END;

-- The send gate. Sending means: approved by a person (mode human), or a draft the desk is
-- trusted and allowed to send on its own (mode auto). Never while held or locked by someone else.
DROP TRIGGER IF EXISTS action_send_gate;
CREATE TRIGGER action_send_gate BEFORE UPDATE OF status ON actions
WHEN NEW.status = 'sending' AND OLD.status IS NOT 'sending'
BEGIN
  SELECT RAISE(ABORT, 'say who is sending: set sent_by') WHERE NEW.sent_by IS NULL;
  SELECT RAISE(ABORT, 'only an approved action (mode human) or a trusted draft (mode auto) can be sent')
    WHERE NOT ((OLD.status = 'approved' AND NEW.mode IS 'human')
            OR (OLD.status = 'draft' AND NEW.mode IS 'auto'));
  SELECT RAISE(ABORT, 'held: a hold or do-not-contact covers this, so it cannot go out')
    WHERE EXISTS (SELECT 1 FROM active_hold_keys h
      WHERE (h.desk IS NULL OR h.desk = OLD.desk) AND (h.topic = 'all' OR h.topic = OLD.kind)
        AND (h.key = '*' OR h.key IN (SELECT key FROM action_touches WHERE action_id = OLD.id)));
  SELECT RAISE(ABORT, 'locked: someone else is working on this. Take the lock over first if you mean to')
    WHERE EXISTS (SELECT 1 FROM locks l WHERE l.by IS NOT NEW.sent_by
      AND (l.key = 'action:' || OLD.id OR l.key IN (SELECT key FROM action_touches WHERE action_id = OLD.id)));
  SELECT RAISE(ABORT, 'still learning: coached examples always go to a person')
    WHERE NEW.mode IS 'auto' AND OLD.stage = 'coached';
  SELECT RAISE(ABORT, 'not trusted to go out on its own yet: show it for review')
    WHERE NEW.mode IS 'auto' AND NOT EXISTS (SELECT 1 FROM trust t WHERE t.desk = OLD.desk
      AND t.kind = OLD.kind AND t.channel = OLD.channel AND t.identity = OLD.identity
      AND t.trusted = 1 AND t.always_human = 0);
  SELECT RAISE(ABORT, 'spot check due: show this one in full for review')
    WHERE NEW.mode IS 'auto' AND (OLD.spot_check = 1 OR EXISTS (SELECT 1 FROM trust t
      WHERE t.desk = OLD.desk AND t.kind = OLD.kind AND t.channel = OLD.channel
        AND t.identity = OLD.identity AND t.since_check >= t.check_every - 1));
  SELECT RAISE(ABORT, 'nobody has allowed this to go out on its own: ask, and record it in allowed')
    WHERE NEW.mode IS 'auto' AND NOT EXISTS (SELECT 1 FROM active_allowed a WHERE a.desk = OLD.desk
      AND a.kind = OLD.kind AND a.channel = OLD.channel AND a.identity = OLD.identity);
END;
-- A brief is checked when it's written and whenever its target or payload changes, so an
-- approved brief is always one that can be sent. The rules are in brief_faults.
DROP TRIGGER IF EXISTS brief_send_gate;
DROP TRIGGER IF EXISTS brief_written;
CREATE TRIGGER brief_written AFTER INSERT ON actions WHEN NEW.channel = 'desk'
BEGIN
  SELECT RAISE(ABORT, 'a brief goes to another desk in this database: target is desk:<name>')
    FROM brief_faults WHERE id = NEW.id AND bad_target;
  SELECT RAISE(ABORT, 'a brief says how we will know it is done: set payload.done_when')
    FROM brief_faults WHERE id = NEW.id AND no_done_when;
  SELECT RAISE(ABORT, 'a brief goes to the desk''s agent or a builder: payload.owner is agent or builder')
    FROM brief_faults WHERE id = NEW.id AND bad_owner;
  SELECT RAISE(ABORT, 'a brief''s payload.due is a date: YYYY-MM-DD')
    FROM brief_faults WHERE id = NEW.id AND bad_due;
END;
DROP TRIGGER IF EXISTS brief_edited;
CREATE TRIGGER brief_edited AFTER UPDATE OF target, payload ON actions WHEN NEW.channel = 'desk'
BEGIN
  SELECT RAISE(ABORT, 'a brief goes to another desk in this database: target is desk:<name>')
    FROM brief_faults WHERE id = NEW.id AND bad_target;
  SELECT RAISE(ABORT, 'a brief says how we will know it is done: set payload.done_when')
    FROM brief_faults WHERE id = NEW.id AND no_done_when;
  SELECT RAISE(ABORT, 'a brief goes to the desk''s agent or a builder: payload.owner is agent or builder')
    FROM brief_faults WHERE id = NEW.id AND bad_owner;
  SELECT RAISE(ABORT, 'a brief''s payload.due is a date: YYYY-MM-DD')
    FROM brief_faults WHERE id = NEW.id AND bad_due;
END;
-- A brief is delivered once its task exists, so it is never recorded as delivered without one.
DROP TRIGGER IF EXISTS brief_sent_has_task;
CREATE TRIGGER brief_sent_has_task BEFORE UPDATE OF status ON actions
WHEN NEW.status IN ('sent','verified') AND OLD.status IS NOT NEW.status AND NEW.channel = 'desk'
BEGIN
  SELECT RAISE(ABORT, 'a brief is sent by delivering it as a task: node desks/desk.mjs send <id>')
    WHERE NOT EXISTS (SELECT 1 FROM tasks t WHERE t.source = 'brief:' || NEW.id
      AND 'task:' || t.id = NEW.provider_ref);
END;

DROP TRIGGER IF EXISTS action_sending;
CREATE TRIGGER action_sending AFTER UPDATE OF status ON actions
WHEN NEW.status = 'sending' AND OLD.status IS NOT 'sending'
BEGIN
  UPDATE trust SET since_check = since_check + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
    WHERE NEW.mode = 'auto' AND desk = NEW.desk AND kind = NEW.kind AND channel = NEW.channel
      AND identity = NEW.identity;
  UPDATE actions SET
    sent_at = coalesce(NEW.sent_at, strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    trust_epoch = CASE WHEN NEW.mode = 'auto' THEN (SELECT t.epoch FROM trust t WHERE t.desk = NEW.desk
      AND t.kind = NEW.kind AND t.channel = NEW.channel AND t.identity = NEW.identity) ELSE NEW.trust_epoch END
  WHERE id = NEW.id;
END;

-- Trust is scored once, when the result is verified.
DROP TRIGGER IF EXISTS action_verified;
CREATE TRIGGER action_verified AFTER UPDATE OF status ON actions
WHEN NEW.status = 'verified' AND OLD.status IS NOT 'verified' AND NEW.trust_counted_at IS NULL
BEGIN
  UPDATE trust SET coached = coached + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
    WHERE NEW.stage = 'coached' AND desk = NEW.desk AND kind = NEW.kind AND channel = NEW.channel
      AND identity = NEW.identity;
  UPDATE trust SET clean = clean + 1, since_check = 0,
      trusted = CASE WHEN always_human = 0 AND clean + 1 >= needed THEN 1 ELSE trusted END,
      updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
    WHERE NEW.stage = 'drafted' AND NEW.mode = 'human' AND NEW.edited = 0 AND NEW.trust_epoch = epoch
      AND desk = NEW.desk AND kind = NEW.kind AND channel = NEW.channel AND identity = NEW.identity;
  UPDATE actions SET trust_counted_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'),
      verified_at = coalesce(NEW.verified_at, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    WHERE id = NEW.id;
END;

-- A change after review, or a rejection, starts trust for that kind again.
DROP TRIGGER IF EXISTS action_edited_resets_trust;
CREATE TRIGGER action_edited_resets_trust AFTER UPDATE OF edited ON actions
WHEN OLD.edited = 0 AND NEW.edited = 1 AND NEW.stage = 'drafted'
BEGIN
  UPDATE trust SET clean = 0, trusted = 0, since_check = 0, epoch = epoch + 1,
      updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
    WHERE desk = NEW.desk AND kind = NEW.kind AND channel = NEW.channel AND identity = NEW.identity;
  INSERT INTO log(desk, by, kind, about, action_id, summary) VALUES (NEW.desk,
    coalesce(NEW.last_by, NEW.created_by), 'trust', NEW.about, NEW.id,
    'trust for ' || NEW.kind || ' starts again: #' || NEW.id || ' was changed after review');
END;
DROP TRIGGER IF EXISTS action_rejected_resets_trust;
CREATE TRIGGER action_rejected_resets_trust AFTER UPDATE OF status ON actions
WHEN NEW.status = 'rejected' AND OLD.status IS NOT 'rejected' AND NEW.stage = 'drafted'
BEGIN
  UPDATE trust SET clean = 0, trusted = 0, since_check = 0, epoch = epoch + 1,
      updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
    WHERE desk = NEW.desk AND kind = NEW.kind AND channel = NEW.channel AND identity = NEW.identity;
  INSERT INTO log(desk, by, kind, about, action_id, summary) VALUES (NEW.desk,
    coalesce(NEW.last_by, NEW.created_by), 'trust', NEW.about, NEW.id,
    'trust for ' || NEW.kind || ' starts again: #' || NEW.id || ' was rejected');
END;

-- Every status change goes in the log. A message accepted by the provider is an 'out',
-- which the follow-up view counts; any other change accepted is 'sent'.
DROP TRIGGER IF EXISTS action_status_log;
CREATE TRIGGER action_status_log AFTER UPDATE OF status ON actions WHEN NEW.status IS NOT OLD.status
BEGIN
  INSERT INTO log(desk, by, kind, about, action_id, summary, ref) VALUES (NEW.desk,
    coalesce(NEW.last_by, NEW.created_by),
    CASE NEW.status
      WHEN 'sent' THEN CASE WHEN NEW.channel IN ('email','linkedin','message','sms','whatsapp','slack','x')
                            THEN 'out' ELSE 'sent' END
      WHEN 'verified' THEN 'verified' WHEN 'failed' THEN 'failed' WHEN 'uncertain' THEN 'uncertain'
      ELSE 'status' END,
    NEW.about, NEW.id,
    '#' || NEW.id || ' ' || NEW.kind || ': ' || OLD.status || ' > ' || NEW.status
      || coalesce(' (' || NEW.mode || ')', '') || coalesce(': ' || NEW.result, ''),
    NEW.provider_ref);
END;

-- A task from a brief (source brief:<action id>) only comes from delivering that brief, once:
-- desk.mjs send makes it while the brief is being sent.
DROP TRIGGER IF EXISTS task_from_brief;
CREATE TRIGGER task_from_brief BEFORE INSERT ON tasks WHEN NEW.source LIKE 'brief:%'
BEGIN
  SELECT RAISE(ABORT, 'a task from a brief is made by sending the brief: node desks/desk.mjs send <id>')
    WHERE NOT EXISTS (SELECT 1 FROM actions a WHERE a.id = CAST(substr(NEW.source, 7) AS INTEGER)
      AND 'brief:' || a.id = NEW.source AND a.channel = 'desk' AND a.status = 'sending' AND a.target = 'desk:' || NEW.desk);
  SELECT RAISE(ABORT, 'that brief was delivered already')
    WHERE EXISTS (SELECT 1 FROM tasks t WHERE t.source = NEW.source);
END;

-- When a desk closes the task a brief gave it, the briefing desk hears how it went.
DROP TRIGGER IF EXISTS task_from_brief_closed;
CREATE TRIGGER task_from_brief_closed AFTER UPDATE OF status ON tasks
WHEN NEW.source LIKE 'brief:%' AND NEW.status IN ('done','dropped','blocked') AND NEW.status IS NOT OLD.status
BEGIN
  INSERT INTO log(desk, by, kind, about, action_id, summary, details)
    SELECT a.desk, 'desk:' || NEW.desk, 'status', 'task:' || NEW.id, a.id,
      'brief #' || a.id || ' to ' || NEW.desk || ': task ' || NEW.id || ' ' || NEW.status
        || coalesce(': ' || NEW.result, ''),
      json_object('task', NEW.id, 'status', NEW.status, 'result', NEW.result, 'proof', NEW.proof)
    FROM actions a WHERE a.id = CAST(substr(NEW.source, 7) AS INTEGER) AND 'brief:' || a.id = NEW.source;
END;

-- Agents tighten, people loosen. An agent (a name in agents) can hold work, revoke what's
-- allowed and take trust away on its own. Approving, allowing, releasing someone else's hold
-- and loosening trust are a person's say-so, recorded under their name with their words.
-- Like every guard here this stops mistakes: an agent that writes a person's name isn't stopped.
DROP TRIGGER IF EXISTS agent_kept;
CREATE TRIGGER agent_kept BEFORE DELETE ON agents
BEGIN SELECT RAISE(ABORT, 'an agent stays an agent: its name is on its work'); END;
DROP TRIGGER IF EXISTS agent_fixed;
CREATE TRIGGER agent_fixed BEFORE UPDATE ON agents
BEGIN SELECT RAISE(ABORT, 'an agent stays an agent: its name is on its work'); END;

DROP TRIGGER IF EXISTS allowed_by_person;
CREATE TRIGGER allowed_by_person BEFORE INSERT ON allowed WHEN NEW.by IN (SELECT name FROM agents)
BEGIN SELECT RAISE(ABORT, 'only a person allows work to go alone: by is the person, and words what they said'); END;
-- What a person allowed stays as they said it, so a revoke is never undone or widened.
DROP TRIGGER IF EXISTS allowed_kept;
CREATE TRIGGER allowed_kept BEFORE UPDATE ON allowed
WHEN NEW.desk IS NOT OLD.desk OR NEW.kind IS NOT OLD.kind OR NEW.channel IS NOT OLD.channel
  OR NEW.identity IS NOT OLD.identity OR NEW.scope IS NOT OLD.scope OR NEW.words IS NOT OLD.words
  OR NEW.by IS NOT OLD.by OR NEW.at IS NOT OLD.at OR NEW.expires_at IS NOT OLD.expires_at
  OR (OLD.revoked_at IS NOT NULL AND (NEW.revoked_at IS NOT OLD.revoked_at OR NEW.revoked_by IS NOT OLD.revoked_by))
BEGIN SELECT RAISE(ABORT, 'what a person allowed stays as they said it: revoke it and allow again with a new row'); END;

-- A hold stays as it was placed and ends by being released, saying who ended it. An agent
-- releases only its own.
DROP TRIGGER IF EXISTS hold_kept;
CREATE TRIGGER hold_kept BEFORE UPDATE ON holds
BEGIN
  SELECT RAISE(ABORT, 'a hold stays as it was placed: release it and place a new one')
    WHERE NEW.desk IS NOT OLD.desk OR NEW.about IS NOT OLD.about OR NEW.topic IS NOT OLD.topic
      OR NEW.until IS NOT OLD.until OR NEW.by IS NOT OLD.by OR NEW.at IS NOT OLD.at
      OR (OLD.released_at IS NOT NULL AND (NEW.released_at IS NOT OLD.released_at OR NEW.released_by IS NOT OLD.released_by));
  SELECT RAISE(ABORT, 'say who released it: set released_by')
    WHERE NEW.released_at IS NOT NULL AND OLD.released_at IS NULL AND NEW.released_by IS NULL;
  SELECT RAISE(ABORT, 'an agent releases only its own holds: the person who placed it, or one they ask, releases it')
    WHERE NEW.released_at IS NOT NULL AND OLD.released_at IS NULL AND NEW.released_by IS NOT OLD.by
      AND NEW.released_by IN (SELECT name FROM agents);
END;
DROP TRIGGER IF EXISTS hold_not_deleted;
CREATE TRIGGER hold_not_deleted BEFORE DELETE ON holds
BEGIN SELECT RAISE(ABORT, 'a hold is released, not deleted: set released_at, released_by and release_reason'); END;

-- Loosening trust needs last_by naming a person and a new note of what they said:
-- fewer clean sends or less coaching needed, rarer spot checks, no longer always a person's,
-- trusted before the count, the spot-check count put back, or counts jumped. The database's
-- own counting (one at a time, or a reset) and taking trust away are anyone's.
DROP TRIGGER IF EXISTS trust_loosened;
CREATE TRIGGER trust_loosened BEFORE UPDATE ON trust
WHEN NEW.needed < OLD.needed OR NEW.coach_needed < OLD.coach_needed OR NEW.check_every > OLD.check_every
  OR NEW.always_human < OLD.always_human OR (NEW.trusted > OLD.trusted AND NEW.clean < NEW.needed)
  OR (NEW.since_check < OLD.since_check AND NEW.clean <= OLD.clean AND NEW.epoch = OLD.epoch)
  OR NEW.clean > OLD.clean + 1 OR NEW.coached > OLD.coached + 1
BEGIN
  SELECT RAISE(ABORT, 'only a person loosens trust: set last_by to the person and note to what they said')
    WHERE NEW.last_by IS NULL OR NEW.last_by IN (SELECT name FROM agents)
      OR trim(coalesce(NEW.note, '')) = '' OR NEW.note IS OLD.note;
END;
-- A new trust row looser than the table's defaults (5 clean, 2 coached, check every 5) is
-- the same. A row that exists already is changed through trust_loosened.
DROP TRIGGER IF EXISTS trust_started;
CREATE TRIGGER trust_started BEFORE INSERT ON trust
WHEN (NEW.needed < 5 OR NEW.coach_needed < 2 OR NEW.check_every > 5 OR NEW.trusted = 1
    OR NEW.clean > 0 OR NEW.coached > 0)
  AND NOT EXISTS (SELECT 1 FROM trust t WHERE t.desk = NEW.desk AND t.kind = NEW.kind
    AND t.channel = NEW.channel AND t.identity = NEW.identity)
BEGIN
  SELECT RAISE(ABORT, 'only a person loosens trust: set last_by to the person and note to what they said')
    WHERE NEW.last_by IS NULL OR NEW.last_by IN (SELECT name FROM agents) OR trim(coalesce(NEW.note, '')) = '';
END;
-- What a person said about trust goes in the log, with the settings it left.
DROP TRIGGER IF EXISTS trust_said;
CREATE TRIGGER trust_said AFTER UPDATE OF note ON trust
WHEN NEW.note IS NOT OLD.note AND NEW.note IS NOT NULL AND NEW.last_by IS NOT NULL
BEGIN
  INSERT INTO log(desk, by, kind, summary, details) VALUES (NEW.desk, NEW.last_by, 'trust',
    'trust for ' || NEW.kind || ' (' || NEW.channel || ', ' || NEW.identity || '): ' || NEW.note,
    json_object('needed', NEW.needed, 'coach_needed', NEW.coach_needed, 'check_every', NEW.check_every,
      'always_human', NEW.always_human, 'trusted', NEW.trusted, 'was', json_object('needed', OLD.needed,
      'coach_needed', OLD.coach_needed, 'check_every', OLD.check_every, 'always_human', OLD.always_human,
      'trusted', OLD.trusted)));
END;
DROP TRIGGER IF EXISTS trust_said_new;
CREATE TRIGGER trust_said_new AFTER INSERT ON trust WHEN NEW.note IS NOT NULL AND NEW.last_by IS NOT NULL
BEGIN
  INSERT INTO log(desk, by, kind, summary, details) VALUES (NEW.desk, NEW.last_by, 'trust',
    'trust for ' || NEW.kind || ' (' || NEW.channel || ', ' || NEW.identity || '): ' || NEW.note,
    json_object('needed', NEW.needed, 'coach_needed', NEW.coach_needed, 'check_every', NEW.check_every,
      'always_human', NEW.always_human, 'trusted', NEW.trusted));
END;

-- An agent gives its own desk tasks, for itself or a person. Another desk gets work from it
-- as a brief, and a task stays on the desk it was given to.
DROP TRIGGER IF EXISTS task_agent_desk;
CREATE TRIGGER task_agent_desk BEFORE INSERT ON tasks
WHEN coalesce(NEW.source, '') NOT LIKE 'brief:%' AND NEW.created_by IN (SELECT name FROM agents)
  AND NOT EXISTS (SELECT 1 FROM agents WHERE name = NEW.created_by AND desk = NEW.desk)
BEGIN SELECT RAISE(ABORT, 'an agent gives another desk work with a brief, not a task: kit/playbooks/briefs.md'); END;
DROP TRIGGER IF EXISTS action_agent_desk;
CREATE TRIGGER action_agent_desk BEFORE INSERT ON actions
WHEN NEW.created_by IN (SELECT name FROM agents)
  AND NOT EXISTS (SELECT 1 FROM agents WHERE name = NEW.created_by AND desk = NEW.desk)
BEGIN SELECT RAISE(ABORT, 'an agent prepares actions on its own desk, and gives another desk work with a brief: kit/playbooks/briefs.md'); END;

-- A GM runs the other desks by briefing them (kit/types/gm). A desk whose desk.md says
-- Type: gm (desks.type, recorded by init) prepares briefs (channel desk) and initiatives
-- (channel gm), nothing else. Left to judge, a model does "small" work itself; this keeps it
-- with the desk that owns it. An initiative always waits for the person.
DROP TRIGGER IF EXISTS gm_briefs_only;
CREATE TRIGGER gm_briefs_only BEFORE INSERT ON actions
WHEN NEW.channel NOT IN ('desk', 'gm') AND EXISTS (SELECT 1 FROM desks WHERE name = NEW.desk AND type = 'gm')
BEGIN SELECT RAISE(ABORT, 'a GM briefs, it doesn''t do: brief the desk that owns this work (channel desk), or propose an initiative (channel gm)'); END;
DROP TRIGGER IF EXISTS initiative_waits;
CREATE TRIGGER initiative_waits BEFORE UPDATE OF status ON actions
WHEN NEW.status = 'sending' AND NEW.mode IS 'auto' AND OLD.channel = 'gm'
BEGIN SELECT RAISE(ABORT, 'an initiative always waits for the person: show it and ask'); END;
DROP TRIGGER IF EXISTS task_stays;
CREATE TRIGGER task_stays BEFORE UPDATE OF desk ON tasks WHEN NEW.desk IS NOT OLD.desk
BEGIN SELECT RAISE(ABORT, 'a task stays on its desk: drop it here and brief the other desk'); END;

-- A check's verdict comes with the measurement it rests on. Once measured, a check is the
-- record of what was seen, and a baseline once taken stays: to look again, add a new check.
DROP TRIGGER IF EXISTS check_measured;
CREATE TRIGGER check_measured BEFORE INSERT ON checks
WHEN NEW.verdict IS NOT NULL AND (NEW.value IS NULL OR NEW.measured_at IS NULL OR NEW.measured_by IS NULL)
BEGIN SELECT RAISE(ABORT, 'a verdict rests on a measurement: set value, measured_at and measured_by with it'); END;
DROP TRIGGER IF EXISTS check_kept;
CREATE TRIGGER check_kept BEFORE UPDATE OF metric, baseline, baseline_from, baseline_to, value, value_from,
  value_to, verdict, source, measured_at, measured_by ON checks
BEGIN
  SELECT RAISE(ABORT, 'a measured check stays as it was measured: to look again, add a new check')
    WHERE OLD.measured_at IS NOT NULL;
  SELECT RAISE(ABORT, 'a baseline stays as it was taken: to start again, add a new check')
    WHERE OLD.baseline IS NOT NULL AND (NEW.baseline IS NOT OLD.baseline OR NEW.metric IS NOT OLD.metric
      OR NEW.baseline_from IS NOT OLD.baseline_from OR NEW.baseline_to IS NOT OLD.baseline_to);
  SELECT RAISE(ABORT, 'a verdict rests on a measurement: set value, measured_at and measured_by with it')
    WHERE NEW.verdict IS NOT NULL AND (NEW.value IS NULL OR NEW.measured_at IS NULL OR NEW.measured_by IS NULL);
END;

-- A question for the person is a task they own with source 'ask'. It's done when they've
-- answered: their words are in the log as a decision about task:<id>, under their own name.
-- It stays a question until then.
DROP TRIGGER IF EXISTS ask_answered;
CREATE TRIGGER ask_answered BEFORE UPDATE OF status, source ON tasks WHEN OLD.source = 'ask'
BEGIN
  SELECT RAISE(ABORT, 'a question stays a question: drop it if it no longer matters')
    WHERE NEW.source IS NOT 'ask';
  SELECT RAISE(ABORT, 'a question is done when the person has answered it: log their words as a decision about task:<id> under their name, then close it')
    WHERE NEW.status = 'done' AND OLD.status IS NOT 'done'
      AND NOT EXISTS (SELECT 1 FROM log g WHERE g.kind = 'decision' AND g.about = 'task:' || OLD.id
        AND g.by NOT IN (SELECT name FROM agents));
END;

-- An audit is of something on that desk, by someone who didn't make, send or record it, and
-- says what was found. A fail or unsure carries evidence. Audits never change.
DROP TRIGGER IF EXISTS audit_written;
CREATE TRIGGER audit_written BEFORE INSERT ON audits
BEGIN
  SELECT RAISE(ABORT, 'audit something on that desk: checked is action:<id>, measure:<id> or task:<id>, and desk is its desk')
    WHERE NOT EXISTS (SELECT 1 FROM audited_work w WHERE w.checked = NEW.checked
      AND w.id = CAST(substr(NEW.checked, instr(NEW.checked, ':') + 1) AS INTEGER) AND w.desk = NEW.desk);
  SELECT RAISE(ABORT, 'nobody audits their own work: another desk''s agent, or the person, checks it')
    WHERE NEW.by IN (SELECT w.by FROM audited_work w WHERE w.checked = NEW.checked
      AND w.id = CAST(substr(NEW.checked, instr(NEW.checked, ':') + 1) AS INTEGER));
  SELECT RAISE(ABORT, 'say what you checked and what you found: notes')
    WHERE trim(NEW.notes) = '';
  SELECT RAISE(ABORT, 'evidence is a list of refs someone could reopen, and a fail or unsure needs at least one')
    WHERE json_type(NEW.evidence) IS NOT 'array'
      OR (NEW.verdict IN ('fail','unsure') AND json_array_length(NEW.evidence) = 0);
END;
DROP TRIGGER IF EXISTS audit_no_update;
CREATE TRIGGER audit_no_update BEFORE UPDATE ON audits
BEGIN SELECT RAISE(ABORT, 'an audit is never changed: audit it again'); END;
DROP TRIGGER IF EXISTS audit_no_delete;
CREATE TRIGGER audit_no_delete BEFORE DELETE ON audits
BEGIN SELECT RAISE(ABORT, 'an audit is never deleted: audit it again'); END;

-- A failed audit of an action starts trust for its kind again, as a rejection does.
DROP TRIGGER IF EXISTS audit_failed_resets_trust;
CREATE TRIGGER audit_failed_resets_trust AFTER INSERT ON audits
WHEN NEW.verdict = 'fail' AND NEW.checked LIKE 'action:%'
BEGIN
  UPDATE trust SET clean = 0, trusted = 0, since_check = 0, epoch = epoch + 1,
      updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
    WHERE EXISTS (SELECT 1 FROM actions a WHERE a.id = CAST(substr(NEW.checked, 8) AS INTEGER) AND a.desk = trust.desk
      AND a.kind = trust.kind AND a.channel = trust.channel AND a.identity = trust.identity);
  INSERT INTO log(desk, by, kind, about, action_id, summary, ref)
    SELECT a.desk, NEW.by, 'trust', a.about, a.id,
      'trust for ' || a.kind || ' starts again: audit #' || NEW.id || ' failed #' || a.id || ': ' || NEW.notes,
      'audit:' || NEW.id
    FROM actions a WHERE a.id = CAST(substr(NEW.checked, 8) AS INTEGER);
END;

DROP TRIGGER IF EXISTS action_touched;
CREATE TRIGGER action_touched AFTER UPDATE ON actions WHEN NEW.updated_at IS OLD.updated_at
BEGIN
  UPDATE actions SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = NEW.id;
END;
