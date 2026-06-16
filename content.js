/**
 * content.js
 * Runs on linkedin.com. Finds job cards / job detail panes, reads the
 * company name, looks it up against the cached sponsor register, and
 * injects a green or red badge next to the company name.
 *
 * Uses structural/attribute selectors instead of class names, because
 * LinkedIn now uses hashed obfuscated class names that change regularly.
 */

(function () {
  const BADGE_CLASS = "uvsc-badge";
  const PROCESSED_ATTR = "data-uvsc-processed";

  let sponsorData = null;
  let dataLoaded = false;

  // ── Sponsor data loading ──────────────────────────────────────────

  function loadSponsorData() {
    chrome.storage.local.get(
      ["sponsorExactNames", "sponsorBuckets"],
      (data) => {
        if (data && data.sponsorExactNames && data.sponsorExactNames.length) {
          sponsorData = {
            exactSet: new Set(data.sponsorExactNames),
            buckets: data.sponsorBuckets || {}
          };
          dataLoaded = true;
          rescanPending();
        }
      }
    );
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
        if (norm.length >= 4 && (c.includes(norm) || norm.includes(c))) return true;
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
      span.title = "Not found on the Home Office register of licensed sponsors. Verify directly with the employer.";
    } else {
      span.classList.add("uvsc-badge--unknown");
      span.textContent = "… loading";
      span.title = "Sponsor register is still loading.";
    }
    return span;
  }

  function insertBadge(anchorEl, status, cardEl) {
    // Remove any existing badge first
    const old = cardEl.querySelector(`:scope .${BADGE_CLASS}`);
    if (old) old.remove();
    const badge = makeBadge(status);
    anchorEl.insertAdjacentElement("afterend", badge);
    return badge;
  }

  // ── Finding the company name ──────────────────────────────────────

  /**
   * LinkedIn job LIST CARD structure (2025/2026):
   *
   *  div[componentkey="job-card-component-ref-JOBID"]   ← card root
   *    figure  (logo)
   *    div
   *      div
   *        div
   *          p  ← job title  (contains <a> or <span> with long text)
   *          div
   *            p  ← COMPANY NAME  ← this is what we want
   *          p  ← location
   *
   * The company name <p> sits between the title and the location.
   * It has no children (just a text node), while title <p> contains
   * nested spans/anchors and location has a different pattern.
   */
  function extractCompanyFromCard(card) {
    // All <p> elements that are direct short-text paragraphs (no links inside)
    const paragraphs = Array.from(card.querySelectorAll("p"));
    for (const p of paragraphs) {
      // Skip if it contains anchor or SVG children — those are title/verified
      if (p.querySelector("a, svg, button")) continue;
      // Skip very long text (job title descriptions)
      const text = (p.textContent || "").trim();
      if (!text || text.length > 80) continue;
      // Skip if the text looks like a date, location clue, or status
      if (/ago|viewed|promoted|easy apply|actively|applicant/i.test(text)) continue;
      // Skip if it looks like a location (contains comma or common location words)
      if (/,\s*[A-Z]/.test(text) || /\b(remote|hybrid|on.site|london|manchester|birmingham|glasgow|edinburgh|bristol|leeds|sheffield|liverpool)\b/i.test(text)) continue;
      // The company name is typically 1-60 chars, no special chars except & . ' -
      if (/[^\w\s&.',()\-]/.test(text)) continue;
      return { el: p, name: text };
    }
    return null;
  }

  /**
   * LinkedIn job DETAIL PANE structure (2025/2026):
   *
   * The detail pane is identified by containing a job title heading
   * and a company-name element. We look for the pattern:
   *   - A heading (h1/h2) or large text = job title
   *   - Next sibling or nearby <a> or <span> = company name (links to company page)
   *
   * Company name in the detail pane is usually inside an <a> that links
   * to /company/... OR a <span>/<div> right after the title heading.
   */
  function extractCompanyFromDetail(pane) {
    // Try: <a> linking to a LinkedIn company page
    const companyLink = pane.querySelector("a[href*='/company/']");
    if (companyLink) {
      const text = (companyLink.textContent || "").trim();
      if (text && text.length < 80) return { el: companyLink, name: text };
    }
    return null;
  }

  // ── Card identification ───────────────────────────────────────────

  /**
   * Returns { el, name, type } or null.
   * type: "card" | "detail"
   */
  function identifyAndExtract(el) {
    // Job list card: has componentkey starting with "job-card-component-ref"
    if (el.matches && el.matches("[componentkey^='job-card-component-ref']")) {
      const found = extractCompanyFromCard(el);
      if (found) return { ...found, type: "card", root: el };
    }

    // Job detail pane: contains a company link + is large enough to be the detail view
    if (el.matches && el.matches("[class*='scaffold-layout__detail'], [data-job-id], .jobs-search__job-details, main")) {
      const found = extractCompanyFromDetail(el);
      if (found) return { ...found, type: "detail", root: el };
    }

    return null;
  }

  // ── Processing ────────────────────────────────────────────────────

  const pendingEls = new Set();

  function processCard(cardEl) {
    // Already finalized?
    if (cardEl.getAttribute(PROCESSED_ATTR) === "true") return;

    let found = null;

    if (cardEl.matches("[componentkey^='job-card-component-ref']")) {
      found = extractCompanyFromCard(cardEl);
    } else {
      found = extractCompanyFromDetail(cardEl);
    }

    if (!found) return;

    const status = checkSponsor(found.name);
    insertBadge(found.el, status, cardEl);

    if (status === null) {
      pendingEls.add(cardEl);
    } else {
      cardEl.setAttribute(PROCESSED_ATTR, "true");
      pendingEls.delete(cardEl);
    }
  }

  function rescanPending() {
    for (const el of Array.from(pendingEls)) {
      processCard(el);
    }
  }

  function scanRoot(root) {
    // Scan list cards
    const cards = root.querySelectorAll
      ? root.querySelectorAll("[componentkey^='job-card-component-ref']")
      : [];
    cards.forEach(processCard);

    // If root itself is a card
    if (root.matches && root.matches("[componentkey^='job-card-component-ref']")) {
      processCard(root);
    }

    // Scan detail pane — look for company links anywhere on page
    const companyLinks = root.querySelectorAll
      ? root.querySelectorAll("a[href*='/company/']")
      : [];
    companyLinks.forEach((link) => {
      const text = (link.textContent || "").trim();
      if (!text || text.length > 80) return;
      // Find the nearest scrollable/structural ancestor as the "card"
      const pane = link.closest(
        "[class*='scaffold-layout__detail'], [data-job-id], .jobs-search__job-details, [class*='job-details'], [class*='jobs-unified-top-card']"
      ) || link.closest("div[class]");
      if (!pane) return;
      if (pane.getAttribute(PROCESSED_ATTR) === "true") return;
      const existing = pane.querySelector(`.${BADGE_CLASS}`);
      if (existing) return; // already badged this pane
      const status = checkSponsor(text);
      insertBadge(link, status, pane);
      if (status !== null) pane.setAttribute(PROCESSED_ATTR, "true");
      else pendingEls.add(pane);
    });
  }

  // ── DOM observation ───────────────────────────────────────────────

  let scanTimeout = null;
  function scheduleScan(root) {
    if (scanTimeout) clearTimeout(scanTimeout);
    scanTimeout = setTimeout(() => {
      scanTimeout = null;
      scanRoot(root || document.body);
    }, 200);
  }

  const observer = new MutationObserver(() => scheduleScan(document.body));
  observer.observe(document.body, { childList: true, subtree: true });

  // Initial scan
  scheduleScan(document.body);
})();
