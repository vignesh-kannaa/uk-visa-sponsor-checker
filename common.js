/**
 * common.js
 * Shared helpers for normalizing company / sponsor names so that
 * LinkedIn's display names can be matched against the Home Office
 * "Register of licensed sponsors: workers" CSV.
 *
 * Loaded by both background.js (via importScripts) and content.js
 * (as an extra content-script file, sharing the same global scope).
 */

// Suffixes / corporate designators that are commonly present in the
// official register but missing (or abbreviated) on LinkedIn, and vice versa.
const SPONSOR_SUFFIXES = [
  "limited",
  "ltd",
  "ltd.",
  "llp",
  "llp.",
  "plc",
  "plc.",
  "inc",
  "inc.",
  "incorporated",
  "corporation",
  "corp",
  "corp.",
  "llc",
  "llc.",
  "l.l.c.",
  "lp",
  "l.p.",
  "company",
  "co",
  "co.",
  "group",
  "holdings",
  "holding",
  "the",
  "uk",
  "u.k.",
  "(uk)",
  "international",
  "global",
  "trust",
  "nhs trust",
  "foundation trust",
];

// Build a regex that strips one or more trailing suffix words.
const SUFFIX_REGEX = new RegExp(
  "\\b(" +
    SPONSOR_SUFFIXES.map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(
      "|"
    ) +
    ")\\b",
  "gi"
);

/**
 * Normalize a company / organisation name for matching:
 *  - lowercase
 *  - replace & with "and"
 *  - strip punctuation
 *  - remove common corporate suffixes (ltd, limited, plc, group, ...)
 *  - collapse whitespace
 */
function normalizeName(name) {
  if (!name) return "";
  let n = name.toLowerCase();
  n = n.replace(/&/g, " and ");
  // remove punctuation (keep letters, numbers, spaces)
  n = n.replace(/[^a-z0-9\s]/g, " ");
  // remove suffix words (can appear multiple times, e.g. "X Group Holdings Limited")
  let prev;
  do {
    prev = n;
    n = n.replace(SUFFIX_REGEX, " ");
  } while (n !== prev);
  // collapse whitespace
  n = n.replace(/\s+/g, " ").trim();
  return n;
}

/**
 * Get the first "significant" word of a normalized name, used as a
 * bucket key for fuzzy lookups. Falls back to the whole string if
 * there's only one word.
 */
function firstWord(normalized) {
  if (!normalized) return "";
  const parts = normalized.split(" ");
  return parts[0] || "";
}

// Export for both service-worker (importScripts) and content-script contexts.
if (typeof module !== "undefined" && module.exports) {
  module.exports = { normalizeName, firstWord };
}
