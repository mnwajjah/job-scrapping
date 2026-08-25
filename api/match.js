const { matchJobs } = require("../lib/matcher");
const { requireAuth } = require("../lib/auth");
const { CV_TEXT } = require("../lib/cv");
const { upsertJob } = require("../lib/jobs-store");
const { migrate } = require("../lib/db");

let dbReady = false;

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

    // Max 10 jobs — 2 batch paralel × 5 = ~10 detik. Aman di 60s timeout.
    const toMatch = jobs.slice(0, 10);
    const scored = await matchJobs({ cvText: CV_TEXT, jobs: toMatch });

    // Save to DB in background
    if (scored.length > 0) {
      try {
        if (!dbReady) { await migrate(); dbReady = true; }
        await Promise.all(
          scored.map((j) =>
            upsertJob(j).catch((err) =>
              console.warn(`[match] Gagal simpan ke DB (${j.url}):`, err.message)
            )
          )
        );
      } catch (dbErr) {
        console.error("[match] DB migration/insertion failed:", dbErr.message);
      }
    }

    // Sort by score descending
    scored.sort((a, b) => (b.matchScore || 0) - (a.matchScore || 0));

    res.status(200).json({ jobs: scored });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
};
