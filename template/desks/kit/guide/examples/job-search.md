# Example: a job-search desk

A candidate's search: find roles, judge fit, prepare tailored applications, apply, and
keep up with recruiters and interviews. It's a conversation desk whose things are jobs.
Borrow the shape, not the criteria.

## desk.md

```markdown
# Job search: senior product designer, London or remote UK
Headline: interviews-month
Target: 4 first interviews a month
Needs: (none: boards are read in the browser)

## Purpose
Land a senior product design role by January. The candidate decides every application;
the desk finds, judges, prepares and keeps track.

## Measures
interviews-month: first interviews booked in the calendar month (job_interviews).
Supporting: applications a week, replies, time from applying to an answer.

## What it does
| Kind | Channel · identity | Approves | Alone? |
| application | the company's form or ATS · the candidate | candidate | never |
| recruiter-reply, thank-you | email · the candidate's address | candidate | can earn it |
| follow-up | email | candidate | can earn it |

## The round
1. Inbox: recruiter mail and ATS updates; move job stages; book interviews as tasks.
2. Due: interview prep, follow-ups after 7 working days.
3. New roles: run the saved searches and the watched companies' boards; judge fit;
   shortlist the best five; prepare packages for the top ones.

## Criteria
Hard stops: below the salary floor (when stated), on-site outside London, never-apply
companies. Fit 0-100 from the brief: seniority, domain, team, location. Apply above 70.
Which CV: master, tailored, or reworked, by fit and the gap.

## Limits
At most 10 applications a week, so each one is good.

## Sources
Greenhouse, Lever and Ashby public job APIs; LinkedIn in the browser; the CV builder
(`bin/cv.mjs`).

## Tables
job_roles, job_companies, job_searches, job_interviews.
```

## schema.sql (the desk's own part)

```sql
CREATE TABLE IF NOT EXISTS job_roles (
  key TEXT PRIMARY KEY,                 -- role:greenhouse:acme:4012345
  title TEXT NOT NULL,
  company TEXT NOT NULL,                -- brand:acme
  url TEXT NOT NULL UNIQUE,
  location TEXT, workplace TEXT CHECK(workplace IN ('remote','hybrid','onsite','unknown')),
  salary TEXT,                          -- exactly as the posting words it; never inferred
  closes_at TEXT,
  description TEXT,                     -- kept in case the posting comes down
  fit INTEGER, fit_notes TEXT,
  cv TEXT CHECK(cv IN ('master','tailor','rework')),
  stage TEXT NOT NULL DEFAULT 'found' CHECK(stage IN ('found','shortlisted','preparing','ready',
    'applied','interviewing','offer','accepted','rejected','withdrawn','skipped','expired')),
  stage_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  source TEXT NOT NULL, last_by TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE IF NOT EXISTS job_interviews (
  id INTEGER PRIMARY KEY,
  role TEXT NOT NULL REFERENCES job_roles(key),
  at TEXT,                              -- local time with its offset: 2026-10-20T14:00+01:00
  kind TEXT, with_whom TEXT, place TEXT,
  status TEXT NOT NULL DEFAULT 'booked' CHECK(status IN ('booked','done','cancelled')),
  notes TEXT,                           -- the candidate's debrief
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
-- job_companies (watched boards, never-apply), job_searches (saved searches), the stage trigger.
```

An application is an action:

- kind `application`, channel `ats`, target `role:...`;
- the payload holds the CV file and its sha256, the cover letter, and every form answer;
- `sent` means the form was submitted, and `verified` means the confirmation email or
  the ATS shows it.

## What it taught

- **Keep the posting text.** Roles come down mid-process, and the interview prep needs
  them.
- **Salary is quoted, never inferred.**
- **Every form answer is part of the approved version.** Changing one answer after
  approval is a new version, and it asks again.
- **Interviews are dated tasks with prep.** The debrief goes in `notes` and becomes
  lessons for the next one.
