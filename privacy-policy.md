# Privacy Policy — UK Visa Sponsor Checker for LinkedIn

Last updated: June 2026

## Overview
UK Visa Sponsor Checker is a Chrome extension that checks LinkedIn job 
listings against the UK Home Office Register of Licensed Sponsors. 
This policy explains what data the extension accesses and how it is handled.

## Data We Collect
**We collect no personal data.**

The extension does not collect, store, transmit, or share any personal 
information about you or your browsing activity.

## Data Stored Locally
The extension stores the following on your device only, using 
Chrome's local storage API:

- The UK Home Office Register of Licensed Sponsors (a public government 
  dataset containing organisation names)
- The timestamp of the last register update

This data never leaves your device and is never sent to any server 
we operate.

## Network Requests
The extension makes network requests only to the following UK government 
domains:

- **www.gov.uk** — to locate the current sponsor register publication page
- **assets.publishing.service.gov.uk** — to download the sponsor register 
  CSV file

These are read-only requests to public UK government websites. 
No personal data is included in these requests.

## LinkedIn
The extension's content script runs on LinkedIn job pages solely to:
- Read company name text from job listing cards
- Inject a visual badge next to company names

No LinkedIn data, account information, messages, or browsing history 
is accessed, stored, or transmitted.

## Third Parties
We do not share any data with third parties. We have no analytics, 
tracking, or advertising integrations.

## Changes
If this policy changes, the updated version will be posted at this URL 
with a revised date.

## Contact
If you have questions about this privacy policy, please open an issue at:
https://github.com/yourusername/uk-visa-sponsor-checker
