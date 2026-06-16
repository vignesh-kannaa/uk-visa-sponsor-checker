const statusEl = document.getElementById("status");
const countEl = document.getElementById("count");
const updatedEl = document.getElementById("updated");
const refreshBtn = document.getElementById("refreshBtn");
const errorBox = document.getElementById("errorBox");

function formatDate(ts) {
  if (!ts) return "Never";
  const d = new Date(ts);
  return d.toLocaleString();
}

function render(data) {
  const status = data.sponsorRefreshStatus || "idle";

  if (status === "refreshing") {
    statusEl.textContent = "Refreshing…";
  } else if (status === "error") {
    statusEl.textContent = "Error";
  } else if (data.sponsorCount) {
    statusEl.textContent = "Ready";
  } else {
    statusEl.textContent = "Not loaded yet";
  }

  countEl.textContent = data.sponsorCount ? data.sponsorCount.toLocaleString() : "–";
  updatedEl.textContent = formatDate(data.sponsorLastUpdated);

  if (status === "error" && data.sponsorRefreshError) {
    errorBox.textContent = "Last refresh failed: " + data.sponsorRefreshError;
    errorBox.hidden = false;
  } else {
    errorBox.hidden = true;
  }

  refreshBtn.disabled = status === "refreshing";
  refreshBtn.textContent = status === "refreshing" ? "Refreshing…" : "Refresh register now";
}

function loadStatus() {
  chrome.runtime.sendMessage({ type: "GET_SPONSOR_STATUS" }, render);
}

refreshBtn.addEventListener("click", () => {
  refreshBtn.disabled = true;
  refreshBtn.textContent = "Refreshing…";
  chrome.runtime.sendMessage({ type: "REFRESH_SPONSOR_REGISTER" }, (result) => {
    loadStatus();
  });
});

loadStatus();
