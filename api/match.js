/**
 * api/match.js — AI matching jobs dengan CV Wajjah.
 * Dilindungi JWT auth.
 * POST /api/match { jobs[] } → { jobs[] with matchScore, techStackMatch, etc }
 * CV otomatis dari lib/cv.js — tidak perlu kirim cvText dari client.
 */

const { matchJobs } = require("../lib/matcher");
const { requireAuth } = require("../lib/auth");
const { CV_TEXT } = require("../lib/cv");

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "Method tidak diizinkan" });
  if (!requireAuth(req, res)) return;

  try {
    if (!process.env.GEMINI_API_KEY) {
      return res.status(400).json({
        error: "GEMINI_API_KEY belum diset di Environment Variables Vercel.",
      });
    }

    const { jobs } = req.body || {};
    if (!Array.isArray(jobs) || jobs.length === 0) {
      return res.status(400).json({ error: "jobs wajib diisi (minimal 1 lowongan)" });
    }

    // Batasi max 15 jobs — 3 batch × 5 jobs = ~15 detik, jauh di bawah timeout 60s
    const toMatch = jobs.slice(0, 15);
    const scored = await matchJobs({ cvText: CV_TEXT, jobs: toMatch });

    // Sort by score descending
    scored.sort((a, b) => (b.matchScore || 0) - (a.matchScore || 0));

    res.status(200).json({ jobs: scored });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
};
