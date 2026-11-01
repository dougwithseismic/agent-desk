-- Who last changed a trust row's settings. Loosening trust needs a person here and a new
-- note of what they said (core.sql, trust_loosened).
ALTER TABLE trust ADD COLUMN last_by TEXT
