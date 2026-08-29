/**
 * Cocok v3 — Unified Frontend Dashboard Script
 * - Default: Memuat lowongan dari Turso DB
 * - Tracker status lamaran yang tersinkronisasi
 * - Filter status, score, dan text search instan (offline)
 * - Pemicu scrape manual langsung memperbarui DB & UI
 */

const TOKEN_KEY = "cocok_token";

// ── State ──────────────────────────────────────────────────────────────────
const state = {
  jobs: [],            // List lowongan dari DB
  statusFilter: "all", // "all", "pending", "applied", etc.
  scoreFilter: "all",  // "all", "high", "mid", "low", "unscored"
  searchQuery: "",     // Filter teks pencarian
};

const STATUS_LABELS = {
  pending: "⏳ Pending",
  applied: "📤 Applied",
  interview: "💬 Interview",
  offered: "🎉 Offered",
  rejected: "❌ Rejected",
  skipped: "🚫 Skip",
};

// ── DOM Refs ───────────────────────────────────────────────────────────────
const $ = (id) => document.getElementById(id);

const el = {
  loginPage:       $("loginPage"),
  dashPage:        $("dashPage"),
  loginForm:       $("loginForm"),
  passwordInput:   $("passwordInput"),
  loginError:      $("loginError"),
  btnLogin:        $("btnLogin"),
  btnLogout:       $("btnLogout"),
  
  // Scraper sidebar refs
  keyword:         $("keyword"),
  location:        $("location"),
  sourceList:      $("sourceList"),
  btnScrape:       $("btnScrape"),
  btnMatch:        $("btnMatch"),
  statusBar:       $("statusBar"),
  statusText:      $("statusText"),
  errorBox:        $("errorBox"),

  // Tracker main content refs
  statTotal:        $("statTotal"),
  statHigh:         $("statHigh"),
  statActionNeeded: $("statActionNeeded"),
  statApplied:      $("statApplied"),
  statInterview:    $("statInterview"),
  
  scoreFilter:      $("scoreFilter"),
  searchInput:      $("searchInput"),
  trackerStatusBar: $("trackerStatusBar"),
  trackerStatusText:$("trackerStatusText"),
  trackerList:      $("trackerList"),
  trackerEmpty:     $("trackerEmpty"),
  cronStatus:       $("cronStatus"),
  cronStatusText:   $("cronStatusText"),
};

// ── Auth Helpers ───────────────────────────────────────────────────────────
function getToken() { return localStorage.getItem(TOKEN_KEY); }
function setToken(t) { localStorage.setItem(TOKEN_KEY, t); }
function clearToken() { localStorage.removeItem(TOKEN_KEY); }

// Perbaiki header auth agar konsisten
function authHeaders() {
  return { "Content-Type": "application/json", Authorization: `Bearer ${getToken()}` };
}

function esc(str) {
  return String(str || "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function formatFriendlyDate(dateStr) {
  if (!dateStr) return "";
  // Ubah YYYY-MM-DD HH:MM:SS menjadi standard ISO UTC agar parsed secara UTC
  const isoStr = dateStr.replace(" ", "T") + "Z";
  const date = new Date(isoStr);
  if (isNaN(date.getTime())) return dateStr;

  const now = new Date();
  const diffMs = now - date;
  const diffMins = Math.floor(diffMs / (1000 * 60));
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffMins < 1) {
    return "Baru saja";
  } else if (diffMins < 60) {
    return `${diffMins} menit lalu`;
  } else if (diffHours < 24) {
    return `${diffHours} jam lalu`;
  } else if (diffDays === 1) {
    return "Kemarin";
  } else if (diffDays < 7) {
    return `${diffDays} hari lalu`;
  } else {
    return date.toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" });
  }
}

async function safeJson(res) {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    const preview = text.slice(0, 150).replace(/<[^>]+>/g, " ").trim();
    throw new Error(`Server error: ${preview}`);
  }
}

// ── Status Messages (Sidebar Scraper) ──────────────────────────────────────
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

// ── Auth Flow ──────────────────────────────────────────────────────────────
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

// Login
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
  loadTracker();
}

// Load scraper sources checkbox
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
  sources.forEach((src) => {
    const wrap = document.createElement("div");
    wrap.className = "chip" + (src.usePuppeteer ? " chip-puppet" : "");

    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.id = `src_${src.id}`;
    cb.value = src.id;
    cb.checked = !src.usePuppeteer; // Default checked yang aman (non-puppeteer)

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

// ── Load Tracker Data (All Jobs dari DB) ──────────────────────────────────
async function loadTracker() {
  el.trackerStatusBar.classList.remove("hidden");
  el.trackerStatusText.textContent = "Memuat data dari database Turso…";
  el.trackerEmpty.classList.add("hidden");

  try {
    // 1. Ambil Statistik real-time
    const statsRes = await fetch("/api/jobs?stats=1", { headers: authHeaders() });
    if (statsRes.status === 401) { clearToken(); showLogin(); return; }
    const statsData = await safeJson(statsRes);
    if (!statsRes.ok) throw new Error(statsData.error || "Gagal memuat statistik.");

    if (statsData.stats) {
      const s = statsData.stats;
      el.statTotal.textContent = s.total || 0;
      el.statHigh.textContent = s.high || 0;
      el.statActionNeeded.textContent = s.action_needed || 0;
      el.statApplied.textContent = s.applied || 0;
      el.statInterview.textContent = s.interview || 0;
    }

    // 2. Ambil List Jobs (Semua, limit 100)
    const jobsRes = await fetch("/api/jobs?status=all&minScore=0&limit=100", { headers: authHeaders() });
    const jobsData = await safeJson(jobsRes);
    if (!jobsRes.ok) throw new Error(jobsData.error || "Gagal memuat daftar lowongan.");
    
    state.jobs = jobsData.jobs || [];
    renderJobs();
    
    el.trackerStatusBar.classList.add("hidden");
  } catch (err) {
    el.trackerStatusText.textContent = "Error: " + err.message;
    el.trackerStatusBar.classList.remove("hidden");
  }
}

// ── Render Jobs List (dengan Filter Frontend Offline) ──────────────────────
function renderJobs() {
  el.trackerList.innerHTML = "";
  
  // Filter jobs di memori untuk kecepatan instan
  const filtered = state.jobs.filter((j) => {
    // Filter Status
    if (state.statusFilter !== "all" && j.status !== state.statusFilter) return false;

    // Filter Skor AI
    const sc = Number(j.matchScore) || 0;
    const hasScore = j.matchScore !== null && j.matchScore !== 0;
    if (state.scoreFilter === "high" && (!hasScore || sc < 70)) return false;
    if (state.scoreFilter === "mid" && (!hasScore || sc < 50 || sc >= 70)) return false;
    if (state.scoreFilter === "low" && (!hasScore || sc >= 50)) return false;
    if (state.scoreFilter === "unscored" && hasScore) return false;

    // Filter Pencarian Teks
    if (state.searchQuery) {
      const q = state.searchQuery.toLowerCase();
      const title = (j.title || "").toLowerCase();
      const company = (j.company || "").toLowerCase();
      const tech = (j.techStackMatch?.matched || []).join(" ").toLowerCase() + " " +
                   (j.techStackMatch?.canLearn || []).join(" ").toLowerCase();
      if (!title.includes(q) && !company.includes(q) && !tech.includes(q)) return false;
    }

    return true;
  });

  el.trackerEmpty.classList.toggle("hidden", filtered.length > 0);

  filtered.forEach((job) => {
    el.trackerList.appendChild(buildTrackerCard(job));
  });
}

// ── Build Job Card ─────────────────────────────────────────────────────────
function buildTrackerCard(job) {
  const card = document.createElement("div");
  card.className = "job-card";
  card.dataset.url = job.url;

  const sc = Number(job.matchScore) || 0;
  const scoreColor = sc >= 70 ? "var(--green)" : sc >= 50 ? "var(--yellow)" : "var(--red)";
  const status = job.status || "pending";
  const badgeClass = `badge-${status}`;

  const matched  = (job.techStackMatch?.matched  || []).map((t) => `<span class="tech-tag match">✓ ${esc(t)}</span>`).join("");
  const canLearn = (job.techStackMatch?.canLearn || []).map((t) => `<span class="tech-tag learn">📚 ${esc(t)}</span>`).join("");
  const missing  = (job.techStackMatch?.missing  || []).map((t) => `<span class="tech-tag missing">✗ ${esc(t)}</span>`).join("");

  // Tombol aksi status lamaran
  const statusKeys = ["pending", "applied", "interview", "offered", "rejected", "skipped"];
  const actionBtns = statusKeys.map((s) => {
    const isActive = status === s ? ` active-${s}` : "";
    return `<button class="status-btn${isActive}" data-status="${s}" data-url="${esc(job.url)}">${STATUS_LABELS[s]}</button>`;
  }).join("");

  card.innerHTML = `
    <div class="job-card-top">
      <div class="job-main">
        <div class="job-title">
          <a href="${esc(job.url)}" target="_blank" rel="noopener">${esc(job.title)}</a>
          <span class="app-status-badge ${badgeClass}">${STATUS_LABELS[status]}</span>
        </div>
        <div class="job-meta">
          <span>${esc(job.company || "")}</span>
          ${job.location ? `<span class="meta-sep">·</span><span>${esc(job.location)}</span>` : ""}
          ${job.salary   ? `<span class="meta-sep">·</span><span class="salary">💰 ${esc(job.salary)}</span>` : ""}
          ${job.sourceLabel || job.source_label ? `<span class="meta-sep">·</span><span class="source-badge">${esc(job.sourceLabel || job.source_label)}</span>` : ""}
        </div>
        <div class="job-dates">
          <span class="date-lbl">🔍 Ditemukan: ${formatFriendlyDate(job.scraped_at)}</span>
          ${job.status_updated_at ? `<span class="meta-sep">·</span><span class="date-lbl">⚡ Update: ${formatFriendlyDate(job.status_updated_at)}</span>` : ""}
        </div>
      </div>
      <div class="job-score-wrap">
        ${sc > 0 ? `
          <div class="score-ring" style="--score-color:${scoreColor}">
            <span class="score-pct">${sc}%</span>
            <span class="score-lbl">${esc(job.chanceLabel || "")}</span>
          </div>
        ` : `
          <div class="score-ring" style="--score-color:var(--text-muted)">
            <span class="score-pct" style="font-size:10px">N/A</span>
            <span class="score-lbl">Belum Analisis</span>
          </div>
        `}
      </div>
    </div>
    ${matched || canLearn || missing ? `<div class="tech-tags" style="margin-top:8px">${matched}${canLearn}${missing}</div>` : ""}
    ${job.reasoning || job.recommendation ? `
      <p style="font-size:12px;color:var(--text-muted);margin-top:6px">
        ${esc(job.reasoning || "")} 
        ${job.recommendation ? `<strong style="color:${scoreColor}">${esc(job.recommendation)}</strong>` : ""}
      </p>
    ` : ""}
    <div class="status-actions">${actionBtns}</div>
  `;

  // Listener tombol ganti status
  card.querySelectorAll(".status-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const newStatus = btn.dataset.status;
      const jobUrl = btn.dataset.url;
      try {
        const res = await fetch("/api/jobs", {
          method: "PATCH",
          headers: authHeaders(),
          body: JSON.stringify({ url: jobUrl, status: newStatus }),
        });
        if (res.ok) {
          // Update status di memory lokal & render ulang agar counter stats update
          const idx = state.jobs.findIndex((j) => j.url === jobUrl);
          if (idx !== -1) {
            state.jobs[idx].status = newStatus;
          }
          // Reload stats & UI
          loadTracker();
        }
      } catch (err) { console.error("Status update gagal:", err); }
    });
  });

  return card;
}

// ── Toolbar Filter Listeners ───────────────────────────────────────────────
document.querySelectorAll(".tracker-filter").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tracker-filter").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    state.statusFilter = btn.dataset.status;
    renderJobs();
  });
});

el.scoreFilter.addEventListener("change", (e) => {
  state.scoreFilter = e.target.value;
  renderJobs();
});

el.searchInput.addEventListener("input", (e) => {
  state.searchQuery = e.target.value.trim();
  renderJobs();
});

// ── Manual Scrape Flow (Saling terhubung ke database) ─────────────────────
el.btnScrape.addEventListener("click", async () => {
  clearError();
  const sources = selectedSources();
  if (sources.length === 0) { showError("Pilih minimal satu sumber."); return; }

  const keyword = el.keyword.value.trim();
  const isAuto = !keyword;

  el.btnScrape.disabled = true;
  showStatus(isAuto
    ? `Scraping otomatis di background & menyimpan ke DB Turso…`
    : `Scraping "${keyword}" & menyimpan ke DB Turso…`);

  try {
    // 1. Panggil Scrape API (Ini otomatis menyimpan lowongan baru ke DB)
    const res = await fetch("/api/search", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ keyword, location: el.location.value.trim(), sources }),
    });
    if (res.status === 401) { clearToken(); showLogin(); return; }
    const data = await safeJson(res);
    if (!res.ok) throw new Error(data.error || "Gagal scraping.");

    // Tampilkan info jika sebagian sumber gagal
    if (data.errors?.length) {
      showError(`Sebagian sumber gagal: ${data.errors.map((e) => `${e.label} (${e.message})`).join("; ")}`);
    }

    // Refresh UI Tracker agar lowongan mentah baru langsung kelihatan
    await loadTracker();

    // 2. Lakukan Analisis AI (Gemini) manual terhadap lowongan baru tersebut
    const unscoredJobs = state.jobs.filter((j) => j.matchScore === null || j.matchScore === 0);
    if (unscoredJobs.length > 0) {
      showStatus(`Menganalisis ${unscoredJobs.length} lowongan baru dengan Gemini AI…`);
      const matchRes = await fetch("/api/match", {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ jobs: unscoredJobs }),
      });
      const matchData = await safeJson(matchRes);
      if (!matchRes.ok) throw new Error(matchData.error || "Gagal analisis AI.");
      
      // Reload ulang Tracker untuk menampilkan data termatch yang tersimpan di DB
      await loadTracker();
    }

  } catch (err) {
    showError(err.message);
  } finally {
    el.btnScrape.disabled = false;
    hideStatus();
  }
});
