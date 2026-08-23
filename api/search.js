/**
 * api/search.js — Scrape lowongan dari sumber yang dipilih.
 * Dilindungi JWT auth.
 * POST /api/search { sources[], keyword?, location? }
 * Keyword OPSIONAL — kalau kosong, pakai auto-keywords dari CV Wajjah.
 */

// Keywords otomatis dari CV Wajjah kalau user tidak isi keyword
const AUTO_KEYWORDS = [
  "fullstack developer",
  "backend developer",
  "nodejs developer",
  "react developer",
  "web developer",
];

const { BY_ID, SOURCES } = require("../lib/sources");
const { requireAuth } = require("../lib/auth");

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "Method tidak diizinkan" });
  if (!requireAuth(req, res)) return;

  try {
    const { keyword, location, sources } = req.body || {};

    // Keyword opsional — kalau kosong, pakai auto-keywords dari CV
    const keywords = keyword && keyword.trim()
      ? [keyword.trim()]
      : AUTO_KEYWORDS;

    const ids = Array.isArray(sources) && sources.length ? sources : ["glints"];
    const selected = ids.map((id) => BY_ID[id]).filter(Boolean);
    if (selected.length === 0) {
      return res.status(400).json({ error: `Sumber tidak dikenal: ${ids.join(", ")}` });
    }

    // Scrape semua keyword × semua sumber
    const allSettled = await Promise.allSettled(
      keywords.flatMap((kw) =>
        selected.map((src) => src.searchJobs({ keyword: kw, location, maxResults: 15 }))
      )
    );

    // Map results back ke source
    const results = [];
    let kwIdx = 0, srcIdx = 0;
    allSettled.forEach((r) => {
      results.push({ r, src: selected[srcIdx] });
      srcIdx++;
      if (srcIdx >= selected.length) { srcIdx = 0; kwIdx++; }
    });

    const jobs = [];
    const errors = [];
    const seenErrors = new Set();
    results.forEach(({ r, src }) => {
      if (r.status === "fulfilled") {
        jobs.push(...r.value.map((j) => ({ ...j, source: src.id, sourceLabel: src.label })));
      } else {
        // Deduplikasi error per sumber
        if (!seenErrors.has(src.id)) {
          seenErrors.add(src.id);
          errors.push({ source: src.id, label: src.label, message: r.reason.message, code: r.reason.code || null });
        }
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
