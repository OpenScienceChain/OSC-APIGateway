# Demo UX measurement contract

This report is for directional UX research, not a count of people. Analytics
begins only after an equal-choice Accept/Reject prompt. Accept creates a random
first-party, HttpOnly browser cookie for at most 30 days. The database stores
only an HMAC of that token. Reject stores no browser identity. Revocation
deletes the browser row and all associated UX events. Analytics and survey
records are never joined to accounts, organizations, or contributions.

## Definitions

- **Consenting browsers:** distinct consented browser hashes with an unexpired
  cookie or a retained event in the 30-day reporting window. The report also
  shows active consent cookies separately. One browser can represent multiple
  people; one person can use multiple browsers. Not all visitors consent, so
  this is not total audience size.
- **Visit:** consecutive events from one consenting browser, with a new visit
  after more than 30 minutes of inactivity. Entry and exit are the first and
  last route templates within the visit; a single-page exit has at most one
  pageview. Engagement means multiple pageviews or at least one action.
- **Pageview/journey:** an allowlisted `PAGE_VIEW` event; journeys are adjacent
  pageview route templates in a visit. Query strings and concrete record IDs
  are never accepted.
- **Funnels:** the contribution funnel is form start, attempt, and UI-reported
  completion; the separate exploration funnel is pageview, record view, and
  history view. A visitor can contribute without opening a record, so those
  paths must not share one mandatory sequence. Each stage's denominator is the
  previous stage count; stage zero uses consenting browsers observed in the
  reporting window. Client completions are not authoritative.
  `/internal/metrics` separately reports accepted and confirmed ledger records
  and latency.
- **Hourly device rows:** event and visit-entry hour in UTC, run phase and ID,
  and viewport-size category (small mobile, mobile, tablet, desktop). Device
  category is a width bucket, not device detection.
- **Analytics participation:** consent Accept, Reject, and Revoke button-action
  counts. These are not distinct visitors and cannot measure all non-consenters.
- **Survey:** opens and submissions are anonymous action counts; optional
  answers are stored without browser, account, organization, or record keys.
  The protected comment export is separate from public APIs and the ledger.

Only fixed event names, route templates, and device buckets are accepted.
Search terms, form values, PINs, filenames, hashes, exact record URLs, IPs,
and user-agent strings are not stored in UX events. Responses and events are
given a 30-day expiry and purged at startup and hourly while the API runs; the
operator purge endpoint also supports cleanup. Set `DEMO_UX_RUN_PHASE=LIVE` for the live demo; otherwise
rows are labelled `REHEARSAL`. The run ID comes from the existing demo status.

Protected endpoints require the existing demo control key:

- `GET /api/v1/demo/internal/ux-metrics`
- `GET /api/v1/demo/internal/ux-feedback/comments`
- `POST /api/v1/demo/internal/ux-purge`
- `GET /api/v1/demo/internal/metrics` for server/ledger and queue outcomes

UX reports cap event reconstruction at 100,000 events and expose `truncated`
when that cap is reached. Survey write throttling is per server process and
not a substitute for edge rate limits. The 30-day retention cleanup runs on
access and hourly while the service runs. If the API is stopped beyond the
expiry, cleanup resumes on startup; an offline database does not purge itself.
