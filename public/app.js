const state = {
  jobs: [], // { title, company, location, salary, description, url }
  mode: "scrape",
};

const el = {
  cvText: document.getElementById("cvText"),
  keyword: document.getElementById("keyword"),
  location: document.getElementById("location"),
  btnSearch: document.getElementById("btnSearch"),
  searchError: document.getElementById("searchError"),
  manualJobs: document.getElementById("manualJobs"),
  btnUseManual: document.getElementById("btnUseManual"),
  jobList: document.getElementById("jobList"),
  btnMatch: document.getElementById("btnMatch"),
  matchError: document.getElementById("matchError"),
  loadingOverlay: document.getElementById("loadingOverlay"),
  loadingText: document.getElementById("loadingText"),
};

// Prefill CV dengan default-cv.txt kalau ada (bisa diedit bebas)
fetch("default-cv.txt")
  .then((r) => (r.ok ? r.text() : ""))
  .then((text) => {
    if (text) el.cvText.value = text;
  })
  .catch(() => {});

// --- Tabs ---
document.querySelectorAll(".tab-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    state.mode = btn.dataset.tab;
    document.getElementById("tab-scrape").classList.toggle("hidden", state.mode !== "scrape");
    document.getElementById("tab-manual").classList.toggle("hidden", state.mode !== "manual");
  });
});

function showLoading(text) {
  el.loadingText.textContent = text;
  el.loadingOverlay.classList.remove("hidden");
}
function hideLoading() {
  el.loadingOverlay.classList.add("hidden");
}

function showError(node, message) {
  node.textContent = message;
  node.classList.remove("hidden");
}
function clearError(node) {
  node.classList.add("hidden");
  node.textContent = "";
}

// --- Mode 1: Scraping otomatis ---
el.btnSearch.addEventListener("click", async () => {
  clearError(el.searchError);
  const keyword = el.keyword.value.trim();
  if (!keyword) {
    showError(el.searchError, "Isi kata kunci pencarian dulu.");
    return;
  }

  showLoading("Mencari lowongan di JobStreet…");
  try {
    const res = await fetch("/api/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ keyword, location: el.location.value.trim() }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Gagal mengambil data.");

    state.jobs = data.jobs.map((j) => ({ ...j, matchScore: null }));
    renderJobs();
  } catch (err) {
    showError(
      el.searchError,
      `${err.message} — coba tab "Tempel manual" sebagai alternatif.`
    );
  } finally {
    hideLoading();
  }
});

// --- Mode 2: Tempel manual ---
el.btnUseManual.addEventListener("click", () => {
  const raw = el.manualJobs.value.trim();
  if (!raw) return;

  const blocks = raw.split(/\n-{3,}\n/).map((b) => b.trim()).filter(Boolean);
  state.jobs = blocks.map((block) => {
    const lines = block.split("\n").map((l) => l.trim()).filter(Boolean);
    return {
      title: lines[0] || "(tanpa judul)",
      company: null,
      location: lines[1] || null,
      description: lines.slice(2).join(" ") || lines.slice(1).join(" "),
      url: null,
      matchScore: null,
    };
  });
  renderJobs();
});

// --- Render daftar lowongan ---
function renderJobs() {
  el.jobList.innerHTML = "";
  el.btnMatch.classList.toggle("hidden", state.jobs.length === 0);

  state.jobs.forEach((job, i) => {
    const card = document.createElement("div");
    card.className = "job-card" + (job.matchScore !== null ? " scored" : "");

    const titleHtml = job.url
      ? `<a href="${job.url}" target="_blank" rel="noopener">${escapeHtml(job.title)}</a>`
      : escapeHtml(job.title);

    const scorePill =
      job.matchScore !== null
        ? `<span class="score-pill ${scoreClass(job.matchScore)}">${job.matchScore}</span>`
        : "";

    const reasoning = job.reasoning ? `<p class="job-reasoning">${escapeHtml(job.reasoning)}</p>` : "";

    const tags = [
      ...(job.strengths || []).map((s) => `<span class="tag strength">${escapeHtml(s)}</span>`),
      ...(job.gaps || []).map((g) => `<span class="tag gap">${escapeHtml(g)}</span>`),
    ].join("");

    card.innerHTML = `
      <div class="job-card-top">
        <div>
          <p class="job-title">${titleHtml}</p>
          <p class="job-meta">${[job.company, job.location, job.salary].filter(Boolean).map(escapeHtml).join(" · ")}</p>
        </div>
        ${scorePill}
      </div>
      ${reasoning}
      ${tags ? `<div class="tag-row">${tags}</div>` : ""}
    `;
    el.jobList.appendChild(card);
  });
}

function scoreClass(score) {
  if (score >= 70) return "";
  if (score >= 40) return "mid";
  return "low";
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// --- Cocokkan dengan CV ---
el.btnMatch.addEventListener("click", async () => {
  clearError(el.matchError);
  const cvText = el.cvText.value.trim();
  if (!cvText) {
    showError(el.matchError, "Kotak CV di sebelah kiri masih kosong.");
    return;
  }
  if (state.jobs.length === 0) return;

  showLoading(`Menilai kecocokan ${state.jobs.length} lowongan dengan AI…`);
  try {
    const res = await fetch("/api/match", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cvText, jobs: state.jobs }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Gagal menilai kecocokan.");

    state.jobs = data.jobs;
    renderJobs();
  } catch (err) {
    showError(el.matchError, err.message);
  } finally {
    hideLoading();
  }
});
