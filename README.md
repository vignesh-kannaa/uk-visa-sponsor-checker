# UK Visa Sponsor Checker for LinkedIn

A Chrome extension that scans LinkedIn job listings and tags each one with a
badge:

- 🟩 **"✓ UK Visa Sponsor"** — the employer's name matches an organisation on
  the official Home Office *Register of licensed sponsors: workers*.
- 🟥 **"✗ Not on sponsor register"** — no matching organisation was found.

## How it works

1. **background.js** (a service worker) downloads the current sponsor
   register CSV from `gov.uk` (the publication page is scraped to find the
   latest CSV link, since the filename changes with every update), extracts
   the organisation names, normalizes them (lowercase, strips punctuation and
   common suffixes like "Limited", "Ltd", "Group", "PLC", etc.), and caches
   the result in `chrome.storage.local`. It refreshes automatically once a
   day, and can also be refreshed manually from the popup.
2. **content.js** runs on `linkedin.com`, watches the job search results list
   and the job details pane for company names, normalizes each one the same
   way, and checks it against the cached register. It then inserts a green or
   red badge next to the company name.
3. **popup.html/js** shows when the register was last updated, how many
   sponsor organisations are loaded, and lets you trigger a manual refresh.

## Important caveats — please read

- **Name matching is approximate.** LinkedIn shows a company's "display
  name" (e.g. "Google"), while the Home Office register lists legal entity
  names (e.g. "Google UK Limited"). The extension strips common suffixes
  (Ltd, Limited, PLC, Group, Holdings, etc.) and does fuzzy substring matching
  to bridge this gap, but it **will produce some false positives and false
  negatives** — especially for:
  - Companies with generic names shared by multiple legal entities.
  - Recruitment agencies advertising on behalf of another employer.
  - Companies that have recently gained, lost, or renamed their sponsor
    licence (the register is updated very frequently by the Home Office).
- **This is a convenience tool, not legal/immigration advice.** A red badge
  does **not** definitively mean a company cannot sponsor you, and a green
  badge does **not** guarantee a role comes with sponsorship (the employer
  must still be willing to sponsor *that specific role* and meet salary/skill
  thresholds). Always verify directly with the employer and, if it matters
  for a decision, check the live register yourself:
  https://www.gov.uk/government/publications/register-of-licensed-sponsors-workers
- **LinkedIn's HTML structure changes often.** The selectors in `content.js`
  cover the common job-search and job-detail layouts at the time of writing,
  but LinkedIn periodically redesigns its pages, which may stop badges from
  appearing. If that happens, the selectors in `content.js` (`CARD_CONFIGS`)
  will need updating to match LinkedIn's current DOM.

## File overview

| File | Purpose |
|---|---|
| `manifest.json` | Chrome Manifest V3 configuration |
| `background.js` | Downloads/parses the sponsor register, caches it, daily refresh via `chrome.alarms` |
| `common.js` | Shared name-normalization logic used by both background and content scripts |
| `content.js` | Scans LinkedIn pages and injects badges |
| `content.css` | Badge styling |
| `popup.html/js/css` | Toolbar popup showing register status + manual refresh |
| `icons/` | Extension icons |

## Permissions used

- `storage`, `unlimitedStorage` — to cache the sponsor list (it can contain
  well over 100,000 entries).
- `alarms` — for the daily background refresh.
- Host access to `gov.uk` / `assets.publishing.service.gov.uk` (to download
  the register) and `linkedin.com` (to read job listings and inject badges).
