const statusDotEl = document.getElementById("statusDot");
const headerMetaEl = document.getElementById("headerMeta");
const refreshBtn = document.getElementById("refreshBtn");
const errorBox = document.getElementById("errorBox");
const searchInput = document.getElementById("searchInput");
const searchResultsEl = document.getElementById("searchResults");
const searchHintEl = document.getElementById("searchHint");

function formatDate(ts) {
  if (!ts) return "never";
  const d = new Date(ts);
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  if (sameDay) {
    return (
      "today " +
      d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })
    );
  }
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

function render(data) {
  const status = data.sponsorRefreshStatus || "idle";

  statusDotEl.classList.remove("status-dot--loading", "status-dot--error");

  if (status === "refreshing") {
    statusDotEl.classList.add("status-dot--loading");
    headerMetaEl.textContent = "Refreshing register…";
  } else if (status === "error") {
    statusDotEl.classList.add("status-dot--error");
    headerMetaEl.textContent = "Register refresh failed";
  } else if (data.sponsorCount) {
    const count = data.sponsorCount.toLocaleString();
    headerMetaEl.textContent = `${count} sponsors · updated ${formatDate(
      data.sponsorLastUpdated
    )}`;
  } else {
    statusDotEl.classList.add("status-dot--loading");
    headerMetaEl.textContent = "Not loaded yet";
  }

  if (status === "error" && data.sponsorRefreshError) {
    errorBox.textContent = "Last refresh failed: " + data.sponsorRefreshError;
    errorBox.hidden = false;
  } else {
    errorBox.hidden = true;
  }

  refreshBtn.disabled = status === "refreshing";
}

function loadStatus() {
  chrome.runtime.sendMessage({ type: "GET_SPONSOR_STATUS" }, render);
}

refreshBtn.addEventListener("click", () => {
  refreshBtn.disabled = true;
  chrome.runtime.sendMessage({ type: "REFRESH_SPONSOR_REGISTER" }, () => {
    loadStatus();
  });
});

loadStatus();

// ── Sponsor search ───────────────────────────────────────────────

const MAX_RESULTS = 50;
const MIN_QUERY_LENGTH = 2;
const DEBOUNCE_MS = 150;

let displayNames = null;
let displayNamesLoading = false;
let searchDebounceTimer = null;

function loadDisplayNamesIfNeeded() {
  if (displayNames || displayNamesLoading) return;
  displayNamesLoading = true;
  chrome.storage.local.get(["sponsorDisplayNames"], (data) => {
    displayNamesLoading = false;
    displayNames = (data && data.sponsorDisplayNames) || [];
    runSearch(searchInput.value);
  });
}

function escapeHtml(str) {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function highlightMatch(name, query) {
  const idx = name.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return escapeHtml(name);
  const before = escapeHtml(name.slice(0, idx));
  const match = escapeHtml(name.slice(idx, idx + query.length));
  const after = escapeHtml(name.slice(idx + query.length));
  return `${before}<strong>${match}</strong>${after}`;
}

function renderResults(query, matches, totalMatchCount) {
  searchResultsEl.innerHTML = "";

  if (matches.length === 0) {
    const empty = document.createElement("div");
    empty.className = "result-empty";
    empty.textContent = `No sponsors found matching "${query}"`;
    searchResultsEl.appendChild(empty);
    searchResultsEl.hidden = false;
    return;
  }

  const countRow = document.createElement("div");
  countRow.className = "result-count";
  countRow.textContent =
    totalMatchCount > matches.length
      ? `Showing ${matches.length} of ${totalMatchCount.toLocaleString()}`
      : `${matches.length} match${matches.length === 1 ? "" : "es"}`;
  searchResultsEl.appendChild(countRow);

  for (const name of matches) {
    const item = document.createElement("div");
    item.className = "result-item";

    const nameSpan = document.createElement("span");
    nameSpan.className = "result-name";
    nameSpan.innerHTML = highlightMatch(name, query);

    const badge = document.createElement("span");
    badge.className = "result-badge";
    badge.textContent = "Sponsor";

    item.appendChild(nameSpan);
    item.appendChild(badge);
    searchResultsEl.appendChild(item);
  }

  searchResultsEl.hidden = false;
}

function runSearch(rawQuery) {
  const query = rawQuery.trim();

  if (query.length < MIN_QUERY_LENGTH) {
    searchResultsEl.hidden = true;
    searchResultsEl.innerHTML = "";
    searchHintEl.hidden = false;
    searchHintEl.textContent =
      query.length === 0
        ? "Start typing to search 125,000+ licensed sponsors."
        : `Type at least ${MIN_QUERY_LENGTH} characters…`;
    return;
  }

  searchHintEl.hidden = true;

  if (!displayNames) {
    searchResultsEl.hidden = false;
    searchResultsEl.innerHTML = `<div class="result-empty">Loading sponsor register…</div>`;
    return;
  }

  const lowerQuery = query.toLowerCase();
  const allMatches = [];
  for (const name of displayNames) {
    if (name.toLowerCase().includes(lowerQuery)) {
      allMatches.push(name);
      if (allMatches.length >= MAX_RESULTS * 20) break;
    }
  }

  renderResults(query, allMatches.slice(0, MAX_RESULTS), allMatches.length);
}

searchInput.addEventListener("focus", loadDisplayNamesIfNeeded);

searchInput.addEventListener("input", (e) => {
  loadDisplayNamesIfNeeded();
  clearTimeout(searchDebounceTimer);
  const value = e.target.value;
  searchDebounceTimer = setTimeout(() => runSearch(value), DEBOUNCE_MS);
});
