-- The affiliates desk's own table (kit/types/affiliates). The person and their addresses are
-- in the core people and contacts; this says where each of them stands with the program.
-- What keeps payouts and terms changes with a person is in the core, so it holds whatever
-- happens to this file.

CREATE TABLE IF NOT EXISTS affiliates_people (
  key TEXT PRIMARY KEY CHECK(key LIKE 'person:%'), -- person:jo-bloggs, the same id as in people
  fit TEXT NOT NULL,                    -- why they fit icp.md, and where we saw it
  audience TEXT,                        -- where they recommend things: a newsletter (12k), an agency, a forum
  stage TEXT NOT NULL DEFAULT 'found' CHECK(stage IN
    ('found',                           -- fits icp.md, not yet contacted
     'contacted',                       -- a first touch went out
     'interested',                      -- said yes before the program opened: the waitlist
     'applied',                         -- applied in the product
     'approved',                        -- approved in the product, and has their link
     'earning',                         -- a paid referral in the last 90 days
     'paused',                          -- stopped for now, with notes saying why
     'closed')),                        -- a no, an opt-out, no answer after the follow-up, or removed
  affiliate_id TEXT,                    -- the product's own id for them, once they've applied
  stage_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  notes TEXT,
  source TEXT,                          -- where we found them
  last_by TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- A stage change stamps the time and goes in the log.
DROP TRIGGER IF EXISTS affiliates_people_stage;
CREATE TRIGGER affiliates_people_stage AFTER UPDATE OF stage ON affiliates_people WHEN NEW.stage IS NOT OLD.stage
BEGIN
  UPDATE affiliates_people SET stage_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'),
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE key = NEW.key;
  INSERT INTO log(desk, by, kind, about, summary)
    VALUES ('affiliates', coalesce(NEW.last_by, 'agent'), 'status', NEW.key, NEW.key || ': ' || OLD.stage || ' > ' || NEW.stage);
END;

-- A payout goes to someone the product knows as an affiliate, and who was approved.
DROP TRIGGER IF EXISTS affiliates_payout_to;
CREATE TRIGGER affiliates_payout_to BEFORE INSERT ON actions
WHEN NEW.desk = 'affiliates' AND NEW.kind = 'payout' AND NOT EXISTS (SELECT 1 FROM affiliates_people
  WHERE key = NEW.about AND affiliate_id IS NOT NULL AND stage IN ('approved','earning','paused','closed'))
BEGIN SELECT RAISE(ABORT, 'a payout goes to an approved affiliate: about is their affiliates_people key, with affiliate_id set'); END;

-- A desk that took this type after it had payouts or terms changes: back to a person. From
-- then on the core keeps them there.
UPDATE trust SET always_human = 1
  WHERE desk = 'affiliates' AND kind IN ('payout','terms-change') AND always_human = 0;

-- How many people are at each stage, and since when the longest has waited there: the
-- waitlist (interested) and applications (applied) are what the round reads.
DROP VIEW IF EXISTS affiliates_stages;
CREATE VIEW affiliates_stages AS
  SELECT stage, count(*) AS people, min(stage_at) AS oldest
  FROM affiliates_people GROUP BY stage;
