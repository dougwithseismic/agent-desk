# Changes: baseline, change, check, verdict

For desks that change something and judge it later: SEO, PPC, CRO, pricing. Every change
is an action (`actions.md`) with a check: where things stood before, when to look again,
and what happened.

## The headline

Each desk has one number that says it's working (`Headline:` in `desk.md`). Read it from
its real source at the cadence the plan says, and record it with where it came from:

```sql
INSERT INTO measures(desk, name, value, unit, period_from, period_to, source, by)
VALUES ('seo', 'clicks-28d', 31840, 'clicks', '2026-09-19', '2026-10-16',
  'search console sc-domain:example.com, web, all countries', :me);
```

`status` shows the latest value beside the one before it. Keep the definition fixed:
same source, same filters, same window length. If it has to change, record it under a new
name and say so in `desk.md`. Never fill a gap with an estimate. If the source is down,
the measure is missing for that period.

## The life of a change

1. **Find.** Use the desk's criteria to pick the most valuable change you can defend
   with evidence. Examples: a page with impressions but a weak click rate, a keyword
   spending without converting, a step where visitors drop. Record the thing in the
   desk's table, with its evidence.
2. **Baseline.** Measure the thing itself before changing it, over a window long enough
   to be stable. For SEO that's usually 28 days; for paid search, a few weeks or enough
   clicks. Note the source and the exact filters.
3. **Prepare the change as an action**, with the before and after in the body or payload.
   For example, the old and new title, the bid from and to, the variant copy. Show it
   for approval like anything else.
4. **Apply it.** Claim it (`sending`), make the change, and set `sent` once it's in place.
   That means the PR is merged and deployed, or the API accepted it. Set `verified` once
   you've seen it live: fetch the page and read the title, or read the setting back from
   the platform.
5. **Create the check** as soon as it's sent:

   ```sql
   INSERT INTO checks(desk, action_id, about, metric, baseline, baseline_from, baseline_to, check_at, source, created_by)
   VALUES ('seo', 41, 'page:/stores/nike', 'clicks', 212, '2026-09-19', '2026-10-16', date('now', '+28 day'),
     'search console, page filter, web, all countries', :me);
   ```

6. **Measure when due.** `due` lists checks whose date has come. Measure the same metric,
   from the same source, with the same filters, over a window of the same length after
   the change. Then give a verdict:

   ```sql
   UPDATE checks SET value = 268, value_from = '2026-10-18', value_to = '2026-11-14',
     verdict = 'better', notes = 'CTR 2.1% to 2.9%; position flat at 6.8', measured_at = :now, measured_by = :me
   WHERE id = 9;
   ```

7. **Learn.** A clear win or loss is a lesson for the next change of that kind ("question
   titles beat 'best X' titles on store pages"). A loss may mean preparing the reverse
   change.

## Judging fairly

- **Compare like with like:** the same window length and the same weekdays, and
  year-on-year when the business is seasonal. Write down what else changed in the window
  (a sale, an algorithm update, a site migration).
- **Look past the headline metric.** More clicks at a worse position, or more
  conversions at a much higher cost, isn't simply "better". Note the supporting numbers.
- **Use `unclear`** when the movement is within the normal week-to-week swing, or when
  too much else changed. Unclear is a fine answer. Don't call a win on noise.
- **Use a comparison when you can.** Similar pages left unchanged, campaigns not
  touched, or a proper A/B split for CRO. For an A/B test, record the split, the sample
  size and the stopping rule before it starts, and don't stop early because it looks
  good.
- **Change one thing per item per window,** so the verdict means something. Batches of
  similar changes to many pages are fine, with one check per page plus one for the
  batch.

## Changes made through code

When the change is a code edit (titles in a CMS repo, a template, a redirect):

- the action's `payload` names the branch or PR;
- `sending` means the PR is open or the deploy is running;
- `sent` means merged and deployed;
- `verified` means seen live.

Lock the files' thing keys (`page:/x`) while you work, so two people don't edit the same
page. The person's approval of the action is approval of that change, not of anything
else in the PR.
