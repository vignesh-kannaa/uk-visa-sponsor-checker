/**
 * content.js
 * Runs on linkedin.com. Finds job cards / job detail panes, reads the
 * company name, looks it up against the cached sponsor register, and
 * injects a green or red badge next to the company name.
 */

(function () {
  const BADGE_CLASS = "uvsc-badge";
  const WRAP_CLASS = "uvsc-company-wrap";
  const DONE_ATTR = "data-uvsc-done";

  let sponsorData = null;
  let dataLoaded = false;

  // ── Sponsor data loading ──────────────────────────────────────────

  function loadSponsorData() {
    chrome.storage.local.get(["sponsorExactNames", "sponsorBuckets"], (data) => {
      if (data && data.sponsorExactNames && data.sponsorExactNames.length) {
        sponsorData = {
          exactSet: new Set(data.sponsorExactNames),
          buckets: data.sponsorBuckets || {}
        };
        dataLoaded = true;
        rescanPending();
      }
    });
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && (changes.sponsorExactNames || changes.sponsorBuckets)) {
      loadSponsorData();
    }
  });

  loadSponsorData();

  // ── Matching ─────────────────────────────────────────────────────

  function checkSponsor(companyName) {
    if (!dataLoaded || !sponsorData) return null;
    const norm = normalizeName(companyName);
    if (!norm) return null;
    if (sponsorData.exactSet.has(norm)) return true;
    const fw = firstWord(norm);
    const candidates = sponsorData.buckets[fw];
    if (candidates) {
      for (const c of candidates) {
        if (c === norm) return true;
        if (c.startsWith(norm + " ") || norm.startsWith(c + " ")) return true;
        if (norm.length >= 6 && (c.includes(norm) || norm.includes(c))) return true;
      }
    }
    return false;
  }

  // ── Badge rendering ───────────────────────────────────────────────

  function makeBadge(status) {
    const span = document.createElement("span");
    span.className = BADGE_CLASS;
    if (status === true) {
      span.classList.add("uvsc-badge--sponsor");
      span.textContent = "✓ UK Visa Sponsor";
      span.title = "Found on the Home Office register of licensed sponsors.";
    } else if (status === false) {
      span.classList.add("uvsc-badge--not-sponsor");
      span.textContent = "✗ Not on sponsor register";
      span.title = "Not found on the Home Office register. Verify directly with the employer.";
    } else {
      span.classList.add("uvsc-badge--unknown");
      span.textContent = "… loading";
      span.title = "Sponsor register is still loading.";
    }
    return span;
  }

  function insertBadge(anchorEl, status) {
    const parent = anchorEl.parentElement;
    if (!parent) return;

    // If already wrapped by us, just update the badge
    if (parent.classList.contains(WRAP_CLASS)) {
      const old = parent.querySelector(`.${BADGE_CLASS}`);
      if (old) old.replaceWith(makeBadge(status));
      else parent.appendChild(makeBadge(status));
      return;
    }

    const tag = anchorEl.tagName;
    if (tag === "P" || tag === "DIV") {
      // Wrap block element in a flex container so badge sits inline
      const wrap = document.createElement("div");
      wrap.className = WRAP_CLASS;
      parent.insertBefore(wrap, anchorEl);
      wrap.appendChild(anchorEl);
      wrap.appendChild(makeBadge(status));
    } else {
      // Inline element (<a>, <span>): insert badge immediately after
      anchorEl.insertAdjacentElement("afterend", makeBadge(status));
    }
  }

  // ── Finding the best company link in the detail pane ─────────────

  /**
   * LinkedIn renders the company name in the detail pane as:
   *   <a href="/company/...">   ← OUTER wrapper (contains logo + inner <a>)
   *     <div aria-label="Company, NAME">
   *       <figure>...</figure>
   *       <p>
   *         <a href="/company/...">NAME</a>   ← INNER text-only link
   *       </p>
   *     </div>
   *   </a>
   *
   * We must pick the INNER <a> (text only, no child elements other than
   * text nodes), not the outer wrapper.
   */
  function isTextOnlyCompanyLink(a) {
    const href = a.getAttribute("href") || "";
    if (!href.includes("/company/")) return false;

    // Must not contain block-level children (figure, div, img, svg)
    if (a.querySelector("figure, div, img, svg")) return false;

    // Text content must be short and non-empty
    const text = (a.textContent || "").trim();
    if (!text || text.length < 2 || text.length > 80) return false;

    // Must not be inside a job list card (those handled separately)
    if (a.closest("[componentkey^='job-card-component-ref']")) return false;

    return true;
  }

  // ── Finding company name in job LIST CARDS ────────────────────────

  function extractCompanyFromCard(card) {
    const paragraphs = Array.from(card.querySelectorAll("p"));
    for (const p of paragraphs) {
      if (p.querySelector("svg, button, img")) continue;
      // Allow <p> that contains only an <a> (inner company link pattern)
      const anchors = p.querySelectorAll("a");
      let text = "";
      if (anchors.length === 1 && !p.querySelector("svg")) {
        text = (anchors[0].textContent || "").trim();
      } else if (anchors.length === 0) {
        text = (p.textContent || "").trim();
      }
      if (!text || text.length < 2 || text.length > 80) continue;
      if (/\d+ (week|day|month|hour|minute)s? ago/i.test(text)) continue;
      if (/\b(viewed|promoted|easy apply|actively|applicants|reposted|connections|alumni|verified)\b/i.test(text)) continue;
      if (/\b(remote|hybrid|on-site|on site)\b/i.test(text) && text.length < 30) continue;
      if (/^[A-Z][^,]{1,40},\s*[A-Z]/.test(text)) continue;
      if (/\(remote\)|\(hybrid\)|\(on.site\)/i.test(text)) continue;
      // Return the inner <a> if present (so badge goes inline with text)
      const el = anchors.length === 1 ? anchors[0] : p;
      return { el, name: text };
    }
    return null;
  }

  // ── Processing ────────────────────────────────────────────────────

  const pendingCards = new Set();
  const pendingLinks = new Set();

  function processCard(card) {
    if (card.getAttribute(DONE_ATTR)) return;
    const found = extractCompanyFromCard(card);
    if (!found) return;
    card.setAttribute(DONE_ATTR, "true");
    const status = checkSponsor(found.name);
    insertBadge(found.el, status);
    if (status === null) pendingCards.add(card);
  }

  function processDetailLinks() {
    // Only select text-only company links that haven't been processed
    const allLinks = document.querySelectorAll(`a[href*='/company/']:not([${DONE_ATTR}])`);
    for (const link of allLinks) {
      if (!isTextOnlyCompanyLink(link)) {
        // Mark outer wrapper links as done so we skip them too
        link.setAttribute(DONE_ATTR, "skip");
        continue;
      }
      link.setAttribute(DONE_ATTR, "true");
      const text = (link.textContent || "").trim();
      const status = checkSponsor(text);
      insertBadge(link, status);
      if (status === null) pendingLinks.add(link);
    }
  }

  function rescanPending() {
    for (const card of Array.from(pendingCards)) {
      const found = extractCompanyFromCard(card);
      if (!found) continue;
      const status = checkSponsor(found.name);
      if (status === null) continue;
      const old = card.querySelector(`.${BADGE_CLASS}`);
      if (old) old.replaceWith(makeBadge(status));
      pendingCards.delete(card);
    }
    for (const link of Array.from(pendingLinks)) {
      const text = (link.textContent || "").trim();
      const status = checkSponsor(text);
      if (status === null) continue;
      const old = link.parentElement && link.parentElement.querySelector(`.${BADGE_CLASS}`);
      if (old) old.replaceWith(makeBadge(status));
      pendingLinks.delete(link);
    }
  }

  // ── Full page scan ────────────────────────────────────────────────

  function scanPage() {
    document.querySelectorAll("[componentkey^='job-card-component-ref']")
      .forEach(processCard);
    processDetailLinks();
  }

  // ── DOM observation ───────────────────────────────────────────────

  let scanTimeout = null;
  function scheduleScan() {
    if (scanTimeout) clearTimeout(scanTimeout);
    scanTimeout = setTimeout(() => { scanTimeout = null; scanPage(); }, 250);
  }

  const observer = new MutationObserver(scheduleScan);
  observer.observe(document.body, { childList: true, subtree: true });
  scheduleScan();
})();
