/**
 * api/search.js — Scrape lowongan dari sumber yang dipilih.
 * Dilindungi JWT auth.
 * POST /api/search { sources[], keyword?, location? }
 * Keyword OPSIONAL — kalau kosong, pakai auto-keywords dari CV Wajjah.
 *
 * Strategy kalau auto (keyword kosong):
 *   - Scrape tiap sumber dengan 1 keyword saja (yang paling broad)
 *   - Jaga agar total requests tidak meledak / timeout
 */

const { BY_ID } = require("../lib/sources");
const { requireAuth } = require("../lib/auth");

// Keywords ringkas untuk auto-mode (urut dari paling broad)
const AUTO_KEYWORDS = ["developer", "fullstack", "backend", "nodejs"];

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "Method tidak diizinkan" });
  if (!requireAuth(req, res)) return;

  try {
    const { keyword, location, sources } = req.body || {};

    const ids = Array.isArray(sources) && sources.length ? sources : ["glints"];
    const selected = ids.map((id) => BY_ID[id]).filter(Boolean);
    if (selected.length === 0) {
      return res.status(400).json({ error: `Sumber tidak dikenal: ${ids.join(", ")}` });
    }

    const isAuto = !keyword || !keyword.trim();
    const jobs = [];
    const errors = [];
    const seenUrls = new Set();
    const seenErrorSources = new Set();

    if (isAuto) {
      // AUTO MODE: tiap sumber scrape dengan 1 keyword saja (rotasi per sumber)
      // Ini menghindari 5×N request sekaligus yang bisa timeout
      const settled = await Promise.allSettled(
        selected.map((src, i) => {
          const kw = AUTO_KEYWORDS[i % AUTO_KEYWORDS.length];
          return src.searchJobs({ keyword: kw, location: location || "", maxResults: 20 });
        })
      );

      settled.forEach((r, i) => {
        const src = selected[i];
        if (r.status === "fulfilled") {
          r.value.forEach((j) => {
            if (j.url && !seenUrls.has(j.url)) {
              seenUrls.add(j.url);
              jobs.push({ ...j, source: src.id, sourceLabel: src.label });
            }
          });
        } else {
          errors.push({ source: src.id, label: src.label, message: r.reason?.message, code: r.reason?.code || null });
        }
      });
    } else {
      // MANUAL MODE: scrape semua sumber dengan keyword yang diberikan
      const settled = await Promise.allSettled(
        selected.map((src) => src.searchJobs({ keyword: keyword.trim(), location: location || "", maxResults: 20 }))
      );

      settled.forEach((r, i) => {
        const src = selected[i];
        if (r.status === "fulfilled") {
          r.value.forEach((j) => {
            if (j.url && !seenUrls.has(j.url)) {
              seenUrls.add(j.url);
              jobs.push({ ...j, source: src.id, sourceLabel: src.label });
            }
          });
        } else {
          errors.push({ source: src.id, label: src.label, message: r.reason?.message, code: r.reason?.code || null });
        }
      });
    }

    if (jobs.length === 0) {
      return res.status(500).json({
        error: isAuto
          ? "Semua sumber gagal di-scrape. Coba pilih sumber lain atau isi kata kunci manual."
          : `Tidak ada lowongan untuk "${keyword}". Coba kata kunci lain.`,
        errors,
      });
    }

    res.status(200).json({ jobs, errors: errors.length ? errors : undefined, isAuto });
  } catch (err) {
    console.error("[search] error:", err);
    res.status(500).json({ error: err.message || "Terjadi kesalahan di server." });
  }
};
