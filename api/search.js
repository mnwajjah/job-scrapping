/**
 * api/search.js — Scrape lowongan dari sumber yang dipilih.
 * Dilindungi JWT auth.
 * POST /api/search { sources[], keyword, location }
 */

const { BY_ID, SOURCES } = require("../lib/sources");
const { requireAuth } = require("../lib/auth");

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "Method tidak diizinkan" });
  if (!requireAuth(req, res)) return;

  try {
    const { keyword, location, sources } = req.body || {};
    if (!keyword || !keyword.trim()) {
      return res.status(400).json({ error: "keyword wajib diisi" });
    }

    const ids = Array.isArray(sources) && sources.length ? sources : ["glints"];
    const selected = ids.map((id) => BY_ID[id]).filter(Boolean);
    if (selected.length === 0) {
      return res.status(400).json({ error: `Sumber tidak dikenal: ${ids.join(", ")}` });
    }

    const results = await Promise.allSettled(
      selected.map((src) => src.searchJobs({ keyword, location, maxResults: 20 }))
    );

    const jobs = [];
    const errors = [];
    results.forEach((r, i) => {
      const src = selected[i];
      if (r.status === "fulfilled") {
        jobs.push(...r.value.map((j) => ({ ...j, source: src.id, sourceLabel: src.label })));
      } else {
        errors.push({ source: src.id, label: src.label, message: r.reason.message, code: r.reason.code || null });
      }
    });

    if (jobs.length === 0) {
      return res.status(500).json({ error: "Semua sumber gagal.", errors });
    }

    // Deduplikasi by URL
    const deduped = Array.from(new Map(jobs.filter((j) => j.url).map((j) => [j.url, j])).values());

    res.status(200).json({ jobs: deduped, errors });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
};
