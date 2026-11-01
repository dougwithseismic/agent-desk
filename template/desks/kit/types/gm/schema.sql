-- The GM desk's own tables (kit/types/gm). Everything else it uses is in the core.

-- A bet: something the GM thinks will move the money. It runs with a core check that has its
-- baseline, and is won or lost on what that check says.
CREATE TABLE IF NOT EXISTS gm_bets (
  key TEXT PRIMARY KEY,                 -- bet:annual-plan
  what TEXT NOT NULL,                   -- the bet, in one line
  why TEXT NOT NULL,                    -- the evidence: what we saw, and where
  expects TEXT NOT NULL,                -- the effect on the headline or a funnel step, and by when
  owners TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(owners)), -- the desks doing the work: ["partners"]
  stage TEXT NOT NULL DEFAULT 'proposed' CHECK(stage IN
    ('proposed',                        -- written up, not started
     'running',                         -- the work is under way, and its check has a baseline
     'checking',                        -- the work is done; waiting for the check's date
     'won', 'lost',                     -- the check said so
     'dropped')),                       -- stopped, with notes saying why
  check_id INTEGER REFERENCES checks(id),
  stage_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  notes TEXT,
  source TEXT,
  last_by TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- A stage change stamps the time and goes in the log.
DROP TRIGGER IF EXISTS gm_bets_stage;
CREATE TRIGGER gm_bets_stage AFTER UPDATE OF stage ON gm_bets WHEN NEW.stage IS NOT OLD.stage
BEGIN
  UPDATE gm_bets SET stage_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'),
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE key = NEW.key;
  INSERT INTO log(desk, by, kind, about, summary)
    VALUES ('gm', coalesce(NEW.last_by, 'gm'), 'status', NEW.key, NEW.key || ': ' || OLD.stage || ' > ' || NEW.stage);
END;

-- A bet starts as proposed, so it can only run through the checks below.
DROP TRIGGER IF EXISTS gm_bets_start;
CREATE TRIGGER gm_bets_start BEFORE INSERT ON gm_bets WHEN NEW.stage IS NOT 'proposed'
BEGIN SELECT RAISE(ABORT, 'a bet starts as proposed, then runs once its check has a baseline'); END;

-- Won, lost and dropped are final, and so is the check that decided it: a new try is a new bet.
DROP TRIGGER IF EXISTS gm_bets_final;
CREATE TRIGGER gm_bets_final BEFORE UPDATE OF stage, check_id ON gm_bets
WHEN OLD.stage IN ('won','lost','dropped') AND (NEW.stage IS NOT OLD.stage OR NEW.check_id IS NOT OLD.check_id)
BEGIN SELECT RAISE(ABORT, 'won, lost and dropped are final: a new try is a new bet'); END;

-- A bet runs with a check that has its baseline, and is won or lost on what the check says,
-- never on noise: an unclear verdict means a new check, or dropping the bet.
DROP TRIGGER IF EXISTS gm_bets_checked;
CREATE TRIGGER gm_bets_checked BEFORE UPDATE OF stage, check_id ON gm_bets
WHEN NEW.stage IN ('running','checking','won','lost')
BEGIN
  SELECT RAISE(ABORT, 'a bet runs with a check: record its baseline in checks and set check_id (kit/playbooks/changes.md)')
    WHERE NOT EXISTS (SELECT 1 FROM checks c WHERE c.id = NEW.check_id AND c.baseline IS NOT NULL);
  SELECT RAISE(ABORT, 'a bet is won when its check says better: measure it first')
    WHERE NEW.stage = 'won' AND NOT EXISTS (SELECT 1 FROM checks c WHERE c.id = NEW.check_id AND c.verdict = 'better');
  SELECT RAISE(ABORT, 'a bet is lost when its check says worse or flat: measure it first')
    WHERE NEW.stage = 'lost' AND NOT EXISTS (SELECT 1 FROM checks c WHERE c.id = NEW.check_id AND c.verdict IN ('worse','flat'));
END;

-- Open bets with their checks and briefs: step 4 of the round.
DROP VIEW IF EXISTS gm_bet_board;
CREATE VIEW gm_bet_board AS
  SELECT b.key, b.what, b.expects, b.owners, b.stage,
    round(julianday('now') - julianday(b.stage_at), 1) AS days,
    c.id AS check_id, c.metric, c.baseline, c.check_at, c.value, c.verdict,
    EXISTS (SELECT 1 FROM due d WHERE d.type = 'check' AND d.id = c.id) AS check_due,
    (SELECT count(*) FROM briefs r WHERE r.about = b.key AND r.task_status = 'open') AS open_briefs
  FROM gm_bets b LEFT JOIN checks c ON c.id = b.check_id
  WHERE b.stage IN ('proposed','running','checking');
