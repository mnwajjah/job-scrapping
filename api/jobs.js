/**
 * api/jobs.js — CRUD endpoint untuk job tracker.
 * GET  /api/jobs?status=pending&minScore=50&limit=50
 * GET  /api/jobs?stats=1  → statistik ringkas
 * PATCH /api/jobs  { url, status }  → update status aplikasi
 */

const { requireAuth } = require("../lib/auth");
const { getJobs, getStats, updateStatus } = require("../lib/jobs-store");
const { migrate } = require("../lib/db");

let migrated = false;

module.exports = async (req, res) => {
  if (!requireAuth(req, res)) return;

  // Pastikan tabel sudah ada (lazy migrate)
  if (!migrated) {
    try { await migrate(); migrated = true; }
    catch (err) { return res.status(500).json({ error: "DB migrate error: " + err.message }); }
  }

  // ── GET ────────────────────────────────────────────────────────────────
  if (req.method === "GET") {
    const q = req.query || {};

    // Stats mode
    if (q.stats === "1") {
      try {
        const stats = await getStats();
        return res.status(200).json({ stats });
      } catch (err) {
        return res.status(500).json({ error: err.message });
      }
    }

    // List mode
    try {
      const jobs = await getJobs({
        status:   q.status || "all",
        minScore: Number(q.minScore) || 0,
        limit:    Math.min(Number(q.limit) || 50, 100),
        offset:   Number(q.offset) || 0,
      });

      // Parse JSON fields
      const parsed = jobs.map(parseJob);
      return res.status(200).json({ jobs: parsed, count: parsed.length });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  // ── PATCH ──────────────────────────────────────────────────────────────
  if (req.method === "PATCH") {
    const { url, status } = req.body || {};
    if (!url || !status) {
      return res.status(400).json({ error: "url dan status wajib diisi." });
    }
    try {
      await updateStatus(url, status);
      return res.status(200).json({ ok: true, url, status });
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }
  }

  return res.status(405).json({ error: "Method tidak diizinkan" });
};

function parseJob(j) {
  const tryParse = (v) => { try { return JSON.parse(v); } catch { return []; } };
  return {
    ...j,
    matchScore:     Number(j.match_score) || 0,
    chanceLabel:    j.chance_label,
    recommendation: j.recommendation,
    techStackMatch: {
      matched:  tryParse(j.tech_matched),
      canLearn: tryParse(j.tech_learn),
      missing:  tryParse(j.tech_missing),
    },
    strengths: tryParse(j.strengths),
    gaps:      tryParse(j.gaps),
  };
}
