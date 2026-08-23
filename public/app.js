/**
 * Cocok v2 — Frontend App
 * Auth flow → Dashboard dengan scrape + AI match otomatis dari CV Wajjah
 */

const TOKEN_KEY = "cocok_token";

// ── State ──────────────────────────────────────────────────────────────────
const state = {
  jobs: [],
  filter: "all",
};

// ── DOM Refs ───────────────────────────────────────────────────────────────
const $ = (id) => document.getElementById(id);

const el = {
  loginPage:    $("loginPage"),
  dashPage:     $("dashPage"),
  loginForm:    $("loginForm"),
  passwordInput:$("passwordInput"),
  loginError:   $("loginError"),
  btnLogin:     $("btnLogin"),
  btnLogout:    $("btnLogout"),
  keyword:      $("keyword"),
  location:     $("location"),
  sourceList:   $("sourceList"),
  btnScrape:    $("btnScrape"),
  btnMatch:     $("btnMatch"),
  statusBar:    $("statusBar"),
  statusText:   $("statusText"),
  errorBox:     $("errorBox"),
  statsRow:     $("statsRow"),
  statTotal:    $("statTotal"),
  statMatched:  $("statMatched"),
  statGood:     $("statGood"),
  filterRow:    $("filterRow"),
  jobList:      $("jobList"),
  emptyState:   $("emptyState"),
  cronStatus:   $("cronStatus"),
  cronStatusText:$("cronStatusText"),
};

// ── Helpers ────────────────────────────────────────────────────────────────
function getToken() { return localStorage.getItem(TOKEN_KEY); }
function setToken(t) { localStorage.setItem(TOKEN_KEY, t); }
function clearToken() { localStorage.removeItem(TOKEN_KEY); }

function authHeaders() {
  return { "Content-Type": "application/json", Authorization: `Bearer ${getToken()}` };
}

function esc(str) {
  return String(str || "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function showStatus(text) {
  el.statusText.textContent = text;
  el.statusBar.classList.remove("hidden");
}
function hideStatus() { el.statusBar.classList.add("hidden"); }

function showError(msg) {
  el.errorBox.textContent = msg;
  el.errorBox.classList.remove("hidden");
}
function clearError() { el.errorBox.classList.add("hidden"); }

// ── Auth ───────────────────────────────────────────────────────────────────
function showLogin() {
  el.loginPage.classList.remove("hidden");
  el.dashPage.classList.add("hidden");
  el.passwordInput.focus();
}

function showDash() {
  el.loginPage.classList.add("hidden");
  el.dashPage.classList.remove("hidden");
  initDash();
}

// Check token on load
if (getToken()) {
  showDash();
} else {
  showLogin();
}

// Login form submit
el.loginForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const pw = el.passwordInput.value.trim();
  if (!pw) return;

  el.loginError.classList.add("hidden");
  el.btnLogin.disabled = true;
  el.btnLogin.textContent = "Memproses…";

  try {
    const res = await fetch("/api/auth", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: pw }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Login gagal.");
    setToken(data.token);
    showDash();
  } catch (err) {
    el.loginError.textContent = err.message;
    el.loginError.classList.remove("hidden");
  } finally {
    el.btnLogin.disabled = false;
    el.btnLogin.textContent = "Masuk";
    el.passwordInput.value = "";
  }
});

// Logout
el.btnLogout.addEventListener("click", () => {
  clearToken();
  showLogin();
});

// ── Dashboard Init ─────────────────────────────────────────────────────────
function initDash() {
  loadSources();
  updateEmptyState();
}

// Load sumber lowongan
async function loadSources() {
  try {
    const res = await fetch("/api/sources", { headers: authHeaders() });
    if (res.status === 401) { clearToken(); showLogin(); return; }
    const data = await res.json();
    renderSourceChips(data.sources || []);
  } catch { /* skip */ }
}

function renderSourceChips(sources) {
  el.sourceList.innerHTML = "";
  sources.forEach((src, i) => {
    const wrap = document.createElement("div");
    wrap.className = "chip" + (src.usePuppeteer ? " chip-puppet" : "");

    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.id = `src_${src.id}`;
    cb.value = src.id;
    // Default checked: semua non-puppeteer + glints
    cb.checked = !src.usePuppeteer;

    const lbl = document.createElement("label");
    lbl.htmlFor = `src_${src.id}`;
    lbl.title = src.note || src.label;
    lbl.textContent = src.label;

    wrap.appendChild(cb);
    wrap.appendChild(lbl);
    el.sourceList.appendChild(wrap);
  });
}

function selectedSources() {
  return Array.from(el.sourceList.querySelectorAll("input[type=checkbox]:checked")).map((cb) => cb.value);
}

// ── Scraping ───────────────────────────────────────────────────────────────
el.btnScrape.addEventListener("click", async () => {
  clearError();
  const keyword = el.keyword.value.trim();
  if (!keyword) { showError("Isi kata kunci dulu."); return; }
  const sources = selectedSources();
  if (sources.length === 0) { showError("Pilih minimal satu sumber."); return; }

  el.btnScrape.disabled = true;
  showStatus(`Scraping dari ${sources.length} sumber…`);

  try {
    const res = await fetch("/api/search", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ keyword, location: el.location.value.trim(), sources }),
    });
    if (res.status === 401) { clearToken(); showLogin(); return; }
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Gagal scraping.");

    state.jobs = data.jobs.map((j) => ({ ...j, matchScore: null }));
    renderJobs();
    updateStats();

    if (data.errors?.length) {
      showError(`Sebagian sumber gagal: ${data.errors.map((e) => `${e.label} (${e.message})`).join("; ")}`);
    }
  } catch (err) {
    showError(err.message);
  } finally {
    el.btnScrape.disabled = false;
    hideStatus();
  }
});

// ── AI Match ───────────────────────────────────────────────────────────────
el.btnMatch.addEventListener("click", async () => {
  clearError();
  if (state.jobs.length === 0) return;

  el.btnMatch.disabled = true;
  showStatus(`Menganalisis ${state.jobs.length} lowongan dengan AI…`);

  try {
    const res = await fetch("/api/match", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ jobs: state.jobs }),
    });
    if (res.status === 401) { clearToken(); showLogin(); return; }
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Gagal analisis.");

    state.jobs = data.jobs;
    renderJobs();
    updateStats();
  } catch (err) {
    showError(err.message);
  } finally {
    el.btnMatch.disabled = false;
    hideStatus();
  }
});

// ── Filter ─────────────────────────────────────────────────────────────────
document.addEventListener("click", (e) => {
  const btn = e.target.closest(".filter-btn");
  if (!btn) return;
  document.querySelectorAll(".filter-btn").forEach((b) => b.classList.remove("active"));
  btn.classList.add("active");
  state.filter = btn.dataset.filter;
  renderJobs();
});

function filteredJobs() {
  switch (state.filter) {
    case "high":     return state.jobs.filter((j) => j.matchScore !== null && j.matchScore >= 70);
    case "mid":      return state.jobs.filter((j) => j.matchScore !== null && j.matchScore >= 50 && j.matchScore < 70);
    case "low":      return state.jobs.filter((j) => j.matchScore !== null && j.matchScore < 50);
    case "unscored": return state.jobs.filter((j) => j.matchScore === null);
    default:         return state.jobs;
  }
}

// ── Render Jobs ────────────────────────────────────────────────────────────
function renderJobs() {
  el.jobList.innerHTML = "";
  el.btnMatch.classList.toggle("hidden", state.jobs.length === 0);
  el.filterRow.classList.toggle("hidden", state.jobs.length === 0);
  el.statsRow.classList.toggle("hidden", state.jobs.length === 0);
  updateEmptyState();

  const visible = filteredJobs();
  visible.forEach((job, idx) => {
    el.jobList.appendChild(buildJobCard(job, idx));
  });
}

function buildJobCard(job, idx) {
  const card = document.createElement("div");
  const hasScore = job.matchScore !== null;

  let scoreClass = "none";
  if (hasScore) {
    if (job.matchScore >= 70) scoreClass = "high";
    else if (job.matchScore >= 50) scoreClass = "mid";
    else scoreClass = "low";
  }

  card.className = `job-card${hasScore ? ` scored-${scoreClass}` : ""}`;
  card.dataset.idx = idx;

  const titleHtml = job.url
    ? `<a href="${esc(job.url)}" target="_blank" rel="noopener">${esc(job.title)}</a>`
    : esc(job.title);

  const meta = [job.company, job.location, job.salary].filter(Boolean).map(esc).join(" · ");

  // Score circle
  const scoreHtml = `
    <div class="score-pill">
      <div class="score-circle ${scoreClass}">
        ${hasScore ? job.matchScore + "%" : "—"}
      </div>
      ${hasScore ? `<div class="score-label">${esc(job.chanceLabel || "")}</div>` : ""}
    </div>`;

  // Tech tags
  let detailsHtml = "";
  if (hasScore && job.techStackMatch) {
    const matched = (job.techStackMatch.matched || []).map((t) => `<span class="tech-tag match">✓ ${esc(t)}</span>`).join("");
    const learn = (job.techStackMatch.canLearn || []).map((t) => `<span class="tech-tag learn">📚 ${esc(t)}</span>`).join("");
    const missing = (job.techStackMatch.missing || []).map((t) => `<span class="tech-tag missing">✗ ${esc(t)}</span>`).join("");

    const recClass = job.matchScore >= 70 ? "rec-apply" : job.matchScore >= 50 ? "rec-consider" : "rec-skip";

    detailsHtml = `
      <div class="job-details">
        <div class="detail-row">
          <div class="detail-block">
            <div class="detail-title">Tech Stack</div>
            <div class="tech-tags">${matched}${learn}${missing}</div>
          </div>
          <div class="detail-block">
            <div class="detail-title">Analisis</div>
            <p class="reasoning-text">${esc(job.reasoning || "")}</p>
            ${job.recommendation ? `<span class="recommendation-badge ${recClass}">${esc(job.recommendation)}</span>` : ""}
          </div>
        </div>
      </div>`;
  }

  card.innerHTML = `
    <div class="job-card-top">
      <div class="job-main">
        <div class="job-title">
          ${titleHtml}
          <span class="source-tag">${esc(job.sourceLabel || "")}</span>
        </div>
        ${meta ? `<div class="job-meta">${meta}</div>` : ""}
        ${hasScore ? `<button class="toggle-details">Detail ▾</button>` : ""}
      </div>
      ${scoreHtml}
    </div>
    ${detailsHtml}`;

  // Toggle detail
  const toggleBtn = card.querySelector(".toggle-details");
  if (toggleBtn) {
    toggleBtn.addEventListener("click", () => {
      card.classList.toggle("expanded");
      toggleBtn.textContent = card.classList.contains("expanded") ? "Tutup ▴" : "Detail ▾";
    });
  }

  return card;
}

// ── Stats Update ───────────────────────────────────────────────────────────
function updateStats() {
  const scored = state.jobs.filter((j) => j.matchScore !== null);
  const good = scored.filter((j) => j.matchScore >= 70);
  el.statTotal.textContent = state.jobs.length;
  el.statMatched.textContent = scored.length;
  el.statGood.textContent = good.length;
}

function updateEmptyState() {
  el.emptyState.classList.toggle("hidden", state.jobs.length > 0);
}