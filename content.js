/**
 * content.js
 * Runs on linkedin.com. Finds job cards / job detail panes across
 * LinkedIn's several different DOM layouts, reads the company name,
 * looks it up against the cached sponsor register, and injects a
 * green/red badge next to the company name.
 *
 * LinkedIn currently renders job cards with at least THREE different
 * DOM structures depending on the page:
 *   A) Search results page      -> [componentkey^="job-card-component-ref"]
 *   B) Collections/recommended  -> .job-card-list__entity-lockup (Ember, older)
 *   C) "More jobs for you" rail -> no componentkey, no entity-lockup class,
 *                                  just nested <p> siblings with a "•" separator
 *   D) Job detail pane          -> a[href*="/company/"]
 *
 * We detect all four independently.
 */

(function () {
  const BADGE_CLASS = "uvsc-badge";
  const WRAP_CLASS = "uvsc-company-wrap";
  const DONE_ATTR = "data-uvsc-done";

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
            buckets: data.sponsorBuckets || {},
          };
          dataLoaded = true;
          rescanPending();
        }
      }
    );
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (
      area === "local" &&
      (changes.sponsorExactNames || changes.sponsorBuckets)
    ) {
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
        if (norm.length >= 6 && (c.includes(norm) || norm.includes(c)))
          return true;
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
      span.title =
        "Not found on the Home Office register. Verify directly with the employer.";
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

    if (parent.classList.contains(WRAP_CLASS)) {
      const old = parent.querySelector(`.${BADGE_CLASS}`);
      if (old) old.replaceWith(makeBadge(status));
      else parent.appendChild(makeBadge(status));
      return;
    }

    const tag = anchorEl.tagName;
    if (tag === "P" || tag === "DIV") {
      const wrap = document.createElement("div");
      wrap.className = WRAP_CLASS;
      parent.insertBefore(wrap, anchorEl);
      wrap.appendChild(anchorEl);
      wrap.appendChild(makeBadge(status));
    } else if (tag === "SPAN") {
      // Spans (Ember layout subtitle) — wrap similarly so badge sits inline
      const wrap = document.createElement("span");
      wrap.className = WRAP_CLASS;
      wrap.style.display = "inline-flex";
      wrap.style.alignItems = "center";
      wrap.style.flexWrap = "wrap";
      parent.insertBefore(wrap, anchorEl);
      wrap.appendChild(anchorEl);
      wrap.appendChild(makeBadge(status));
    } else {
      anchorEl.insertAdjacentElement("afterend", makeBadge(status));
    }
  }

  // ── Layout A: Search results cards ────────────────────────────────
  // [componentkey^="job-card-component-ref"]

  function extractCompanyLayoutA(card) {
    const paragraphs = Array.from(card.querySelectorAll("p"));
    for (const p of paragraphs) {
      if (p.querySelector("svg, button, img")) continue;
      const anchors = p.querySelectorAll("a");
      let text = "";
      if (anchors.length === 1) {
        text = (anchors[0].textContent || "").trim();
      } else if (anchors.length === 0) {
        text = (p.textContent || "").trim();
      } else {
        continue;
      }
      if (!isLikelyCompanyText(text)) continue;
      const el = anchors.length === 1 ? anchors[0] : p;
      return { el, name: text };
    }
    return null;
  }

  // ── Layout B: Collections/recommended (Ember, older) ──────────────
  // .job-card-list__entity-lockup  ->  .artdeco-entity-lockup__subtitle span

  function extractCompanyLayoutB(card) {
    const subtitle = card.querySelector(".artdeco-entity-lockup__subtitle");
    if (!subtitle) return null;
    const span = subtitle.querySelector("span");
    const el = span || subtitle;
    const text = (el.textContent || "").trim();
    if (!isLikelyCompanyText(text)) return null;
    return { el, name: text };
  }

  // ── Layout C: "More jobs for you" rail ────────────────────────────
  // No componentkey, no entity-lockup. Structure:
  //   div > p(title) , div > [ p(company), p(•), p(location) ]
  // We target the div that directly contains 2+ sibling <p> tags where
  // the first non-title <p> is the company name.

  function findLayoutCCards(root) {
    // Look for the specific wrapper pattern: a div containing exactly
    // a row of <p> tags including a literal "•" separator paragraph.
    const candidates = root.querySelectorAll("div");
    const found = [];
    for (const div of candidates) {
      // Direct children only (not deep) should be <p> tags
      const directPs = Array.from(div.children).filter(
        (c) => c.tagName === "P"
      );
      if (directPs.length < 2) continue;
      const hasBullet = directPs.some(
        (p) => (p.textContent || "").trim() === "•"
      );
      if (!hasBullet) continue;
      found.push(div);
    }
    return found;
  }

  function extractCompanyLayoutC(metaRow) {
    const directPs = Array.from(metaRow.children).filter(
      (c) => c.tagName === "P"
    );
    // First <p> before the bullet is the company name
    for (const p of directPs) {
      const text = (p.textContent || "").trim();
      if (text === "•") break;
      if (isLikelyCompanyText(text)) {
        return { el: p, name: text };
      }
    }
    return null;
  }

  // ── Layout D: Job detail pane ─────────────────────────────────────
  // a[href*="/company/"] that is text-only (no nested figure/div/img/svg)

  function isTextOnlyCompanyLink(a) {
    const href = a.getAttribute("href") || "";
    if (!href.includes("/company/")) return false;
    if (a.querySelector("figure, div, img, svg")) return false;
    const text = (a.textContent || "").trim();
    if (!isLikelyCompanyText(text)) return false;
    if (
      a.closest(
        "[componentkey^='job-card-component-ref'], .job-card-list__entity-lockup"
      )
    )
      return false;
    return true;
  }

  // ── Shared text filter ─────────────────────────────────────────────

  function isLikelyCompanyText(text) {
    if (!text || text.length < 2 || text.length > 80) return false;
    if (text === "•" || text === "·") return false;
    if (/\d+ (week|day|month|hour|minute)s? ago/i.test(text)) return false;
    if (
      /\b(viewed|promoted|easy apply|actively|applicants|reposted|connections|alumni|verified)\b/i.test(
        text
      )
    )
      return false;
    if (/\b(remote|hybrid|on-site|on site)\b/i.test(text) && text.length < 30)
      return false;
    if (/^[A-Z][^,]{1,40},\s*[A-Z]/.test(text)) return false; // "City, Country"
    if (/\(remote\)|\(hybrid\)|\(on.site\)/i.test(text)) return false;
    return true;
  }

  // ── Processing ────────────────────────────────────────────────────

  const pendingEls = new Set(); // elements awaiting data load, with a re-extract fn

  function applyBadge(el, name, markDoneOn) {
    markDoneOn.setAttribute(DONE_ATTR, "true");
    const status = checkSponsor(name);
    insertBadge(el, status);
    return status;
  }

  function processLayoutA(card) {
    if (card.getAttribute(DONE_ATTR)) return;
    const found = extractCompanyLayoutA(card);
    if (!found) return;
    const status = applyBadge(found.el, found.name, card);
    if (status === null) pendingEls.add({ type: "A", root: card });
  }

  function processLayoutB(card) {
    if (card.getAttribute(DONE_ATTR)) return;
    const found = extractCompanyLayoutB(card);
    if (!found) return;
    const status = applyBadge(found.el, found.name, card);
    if (status === null) pendingEls.add({ type: "B", root: card });
  }

  function processLayoutC(metaRow) {
    if (metaRow.getAttribute(DONE_ATTR)) return;
    const found = extractCompanyLayoutC(metaRow);
    if (!found) return;
    const status = applyBadge(found.el, found.name, metaRow);
    if (status === null) pendingEls.add({ type: "C", root: metaRow });
  }

  function processLayoutD() {
    const links = document.querySelectorAll(
      `a[href*='/company/']:not([${DONE_ATTR}])`
    );
    for (const link of links) {
      if (!isTextOnlyCompanyLink(link)) {
        link.setAttribute(DONE_ATTR, "skip");
        continue;
      }
      const text = (link.textContent || "").trim();
      const status = applyBadge(link, text, link);
      if (status === null) pendingEls.add({ type: "D", root: link });
    }
  }

  function rescanPending() {
    for (const item of Array.from(pendingEls)) {
      let found = null;
      if (item.type === "A") found = extractCompanyLayoutA(item.root);
      else if (item.type === "B") found = extractCompanyLayoutB(item.root);
      else if (item.type === "C") found = extractCompanyLayoutC(item.root);
      else if (item.type === "D") {
        const text = (item.root.textContent || "").trim();
        found = { el: item.root, name: text };
      }
      if (!found) continue;
      const status = checkSponsor(found.name);
      if (status === null) continue;
      const wrap =
        item.root.classList && item.root.classList.contains(WRAP_CLASS)
          ? item.root
          : item.root.querySelector(`.${WRAP_CLASS}`);
      const old = (wrap || item.root).querySelector
        ? (wrap || item.root).querySelector(`.${BADGE_CLASS}`)
        : null;
      if (old) old.replaceWith(makeBadge(status));
      pendingEls.delete(item);
    }
  }

  // ── Full page scan ────────────────────────────────────────────────

  function scanPage() {
    // Layout A: search results
    document
      .querySelectorAll("[componentkey^='job-card-component-ref']")
      .forEach(processLayoutA);

    // Layout B: collections/recommended (Ember)
    document
      .querySelectorAll(".job-card-list__entity-lockup")
      .forEach(processLayoutB);

    // Layout C: "More jobs for you" rail
    findLayoutCCards(document.body).forEach(processLayoutC);

    // Layout D: detail pane
    processLayoutD();
  }

  // ── DOM observation ───────────────────────────────────────────────

  let scanTimeout = null;
  function scheduleScan() {
    if (scanTimeout) clearTimeout(scanTimeout);
    scanTimeout = setTimeout(() => {
      scanTimeout = null;
      scanPage();
    }, 250);
  }

  const observer = new MutationObserver(scheduleScan);
  observer.observe(document.body, { childList: true, subtree: true });
  scheduleScan();
})();
