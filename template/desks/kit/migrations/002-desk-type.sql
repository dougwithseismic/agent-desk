-- What kind of desk it is, from desk.md's Type: line, recorded by init. A gm desk only
-- briefs the desks it runs (core.sql, gm_briefs_only).
ALTER TABLE desks ADD COLUMN type TEXT
