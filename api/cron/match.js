/**
 * api/cron/match.js — Cron #2: AI matching untuk job yang belum di-score.
 * Jadwal: tiap 10 menit, offset 3 menit  (3-59/10 * * * *)
 *
 * Tugas:
 *  - Ambil jobs dari DB yang match_score IS NULL atau 0
 *  - Jalankan AI matching (Gemini, batch paralel)
 *  - Update score di DB
 *  - Respond 200 langsung, proses di background
 */

const { matchJobs }     = require("../../lib/matcher");
const { CV_TEXT }       = require("../../lib/cv");
const { getUnscored, updateJobScore } = require("../../lib/jobs-store");
const { migrate }       = require("../../lib/db");

let dbReady = false;

function checkSecret(req) {
  const secret = process.env.CRON_SECRET;
  const incoming = req.headers["x-cron-secret"] || req.query?.secret;
  return !secret || incoming === secret;
}

function parseJobFromDb(j) {
  return {
    ...j,
    matchScore: Number(j.match_score) || 0,
    sourceLabel: j.source_label,
  };
}

module.exports = async (req, res) => {
  if (req.method !== "POST" && req.method !== "GET")
    return res.status(405).json({ error: "Method tidak diizinkan" });
  if (!checkSecret(req))
    return res.status(401).json({ error: "Unauthorized — invalid cron secret." });

  const runAt = new Date().toISOString();

  res.status(200).json({ ok: true, runAt, step: "match", message: "AI matching started." });

  matchBackground(runAt).catch((err) => console.error("[match] error:", err));
};

async function matchBackground(runAt) {
  if (!dbReady) { await migrate(); dbReady = true; }

  // Ambil max 10 jobs yang belum di-score
  const unscored = await getUnscored(10);
  console.log(`[match] ${unscored.length} jobs unscored`);

  if (unscored.length === 0) {
    console.log("[match] tidak ada yang perlu di-match, skip.");
    return;
  }

  // Jalankan AI matching
  let scored;
  try {
    scored = await matchJobs({ cvText: CV_TEXT, jobs: unscored.map(parseJobFromDb) });
  } catch (err) {
    console.error("[match] AI gagal:", err.message);
    return;
  }

  // Update score ke DB
  let updated = 0;
  for (const job of scored) {
    try {
      await updateJobScore(job);
      updated++;
    } catch (e) {
      console.warn(`[match] update gagal (${job.url}):`, e.message);
    }
  }

  console.log(`[match] done: ${updated}/${unscored.length} jobs di-score`);
}
