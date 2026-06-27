/**
 * background.js
 * - Periodically downloads the Home Office "Register of licensed sponsors:
 *   workers" CSV from gov.uk.
 * - Extracts + normalizes the organisation names.
 * - Stores a compact lookup structure in chrome.storage.local for the
 *   content script to use.
 */

importScripts("common.js");

const REGISTER_PAGE_URL =
  "https://www.gov.uk/government/publications/register-of-licensed-sponsors-workers";

const STORAGE_KEYS = {
  EXACT_SET: "sponsorExactNames", // array of normalized names (exact lookups)
  BUCKETS: "sponsorBuckets", // { firstWord: [normalizedName, ...] }
  DISPLAY_NAMES: "sponsorDisplayNames", // array of original (non-normalized) names, for search UI
  LAST_UPDATED: "sponsorLastUpdated",
  SPONSOR_COUNT: "sponsorCount",
  SOURCE_CSV: "sponsorSourceCsvUrl",
  STATUS: "sponsorRefreshStatus", // "idle" | "refreshing" | "error"
  ERROR: "sponsorRefreshError",
};

const ALARM_NAME = "refreshSponsorRegister";
const REFRESH_INTERVAL_MINUTES = 60 * 24; // once a day

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create(ALARM_NAME, {
    periodInMinutes: REFRESH_INTERVAL_MINUTES,
  });
  refreshSponsorRegister();
});

chrome.runtime.onStartup.addListener(() => {
  refreshSponsorRegister();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_NAME) {
    refreshSponsorRegister();
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message && message.type === "REFRESH_SPONSOR_REGISTER") {
    refreshSponsorRegister().then((result) => sendResponse(result));
    return true; // async
  }
  if (message && message.type === "GET_SPONSOR_STATUS") {
    chrome.storage.local.get(
      [
        STORAGE_KEYS.LAST_UPDATED,
        STORAGE_KEYS.SPONSOR_COUNT,
        STORAGE_KEYS.STATUS,
        STORAGE_KEYS.ERROR,
        STORAGE_KEYS.SOURCE_CSV,
      ],
      (data) => sendResponse(data)
    );
    return true; // async
  }
});

/**
 * Main refresh routine. Returns { ok: boolean, error?: string, count?: number }
 */
async function refreshSponsorRegister() {
  await chrome.storage.local.set({ [STORAGE_KEYS.STATUS]: "refreshing" });

  try {
    const csvUrl = await findCurrentCsvUrl();
    const csvText = await fetchText(csvUrl);
    const { exactNames, buckets, displayNames, count } =
      buildLookupStructures(csvText);

    await chrome.storage.local.set({
      [STORAGE_KEYS.EXACT_SET]: exactNames,
      [STORAGE_KEYS.BUCKETS]: buckets,
      [STORAGE_KEYS.DISPLAY_NAMES]: displayNames,
      [STORAGE_KEYS.SPONSOR_COUNT]: count,
      [STORAGE_KEYS.LAST_UPDATED]: Date.now(),
      [STORAGE_KEYS.SOURCE_CSV]: csvUrl,
      [STORAGE_KEYS.STATUS]: "idle",
      [STORAGE_KEYS.ERROR]: null,
    });

    return { ok: true, count };
  } catch (err) {
    console.error("[UK Visa Sponsor Checker] refresh failed:", err);
    await chrome.storage.local.set({
      [STORAGE_KEYS.STATUS]: "error",
      [STORAGE_KEYS.ERROR]: String(err && err.message ? err.message : err),
    });
    return { ok: false, error: String(err) };
  }
}

/**
 * Fetch the gov.uk publication page and extract the current CSV asset URL.
 * The filename changes with every update (date + content hash), so we
 * scrape it from the page rather than hardcoding it.
 */
async function findCurrentCsvUrl() {
  const html = await fetchText(REGISTER_PAGE_URL);
  const match = html.match(
    /https:\/\/assets\.publishing\.service\.gov\.uk\/media\/[a-zA-Z0-9]+\/[a-zA-Z0-9_-]+_Worker_and_Temporary_Worker.*\.csv/
  );
  if (!match) {
    throw new Error("Could not locate the sponsor register CSV link on gov.uk");
  }
  return match[0];
}

async function fetchText(url) {
  const res = await fetch(url, { credentials: "omit" });
  if (!res.ok) {
    throw new Error(`Fetch failed (${res.status}) for ${url}`);
  }
  return res.text();
}

/**
 * Parse the register CSV and build:
 *  - exactNames: array of normalized organisation names (deduped)
 *  - buckets: map of firstWord -> array indices into exactNames (fuzzy lookup)
 */
function buildLookupStructures(csvText) {
  const rows = parseCsv(csvText);
  if (rows.length === 0) {
    throw new Error("Sponsor CSV appears to be empty");
  }

  const header = rows[0].map((h) => h.trim().toLowerCase());
  // The published register uses "Organisation Name" as the first column.
  let nameIdx = header.findIndex((h) => h.includes("organisation name"));
  if (nameIdx === -1) nameIdx = 0;

  const exactSet = new Set();
  const buckets = {};
  const displayNameSet = new Set(); // original, human-readable names (for search UI)

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row.length <= nameIdx) continue;
    const raw = row[nameIdx];
    if (!raw) continue;

    const trimmedRaw = raw.trim();
    if (trimmedRaw) displayNameSet.add(trimmedRaw);

    const normalized = normalizeName(raw);
    if (!normalized) continue;

    if (!exactSet.has(normalized)) {
      exactSet.add(normalized);
      const fw = firstWord(normalized);
      if (!buckets[fw]) buckets[fw] = [];
      buckets[fw].push(normalized);
    }
  }

  const displayNames = Array.from(displayNameSet).sort((a, b) =>
    a.localeCompare(b)
  );

  return {
    exactNames: Array.from(exactSet),
    buckets,
    displayNames,
    count: exactSet.size,
  };
}

/**
 * Minimal RFC-4180-ish CSV parser (handles quoted fields containing
 * commas, newlines and escaped double-quotes). Returns an array of
 * rows, each an array of string cells.
 */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];

    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n") {
      row.push(field);
      field = "";
      rows.push(row);
      row = [];
    } else if (ch === "\r") {
      // ignore, handled by the following \n
    } else {
      field += ch;
    }
  }

  // last field/row (file may or may not end with a newline)
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows;
}
