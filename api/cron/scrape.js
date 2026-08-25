/**
 * api/cron/scrape.js — Cron #1: Scrape lowongan baru.
 * Jadwal: tiap 5 menit (every 5 minutes)
 *
 * Tugas:
 *  - Scrape semua sumber CRON (non-Puppeteer)
 *  - INSERT OR IGNORE ke DB — job yang sudah ada TIDAK disentuh
 *  - Respond 200 langsung, proses di background
 */

const { CRON_SOURCES } = require("../../lib/sources");
const { insertNewJob } = require("../../lib/jobs-store");
const { migrate }      = require("../../lib/db");

const AUTO_KEYWORDS = ["developer", "fullstack", "backend", "nodejs"];

let dbReady = false;

function checkSecret(req) {
  const secret = process.env.CRON_SECRET;
  const incoming = req.headers["x-cron-secret"] || req.query?.secret;
  return !secret || incoming === secret;
}

module.exports = async (req, res) => {
  if (req.method !== "POST" && req.method !== "GET")
    return res.status(405).json({ error: "Method tidak diizinkan" });
  if (!checkSecret(req))
    return res.status(401).json({ error: "Unauthorized — invalid cron secret." });

  const runAt = new Date().toISOString();

  // Respond langsung — cron-job.org tidak timeout
  res.status(200).json({ ok: true, runAt, step: "scrape", message: "Scraping started." });

  // Background: scrape + insert
  scrapeBackground(runAt).catch((err) => console.error("[scrape] error:", err));
};

async function scrapeBackground(runAt) {
  if (!dbReady) { await migrate(); dbReady = true; }

  // Semua sumber paralel, rotasi keyword
  const settled = await Promise.allSettled(
    CRON_SOURCES.map((src, i) => {
      const kw = AUTO_KEYWORDS[i % AUTO_KEYWORDS.length];
      return src.searchJobs({ keyword: kw, location: "", maxResults: 8 });
    })
  );

  let inserted = 0;
  let skipped  = 0;
  let errors   = 0;

  for (let i = 0; i < settled.length; i++) {
    const r = settled[i];
    const src = CRON_SOURCES[i];
    if (r.status === "rejected") {
      console.warn(`[scrape] ${src.id} gagal:`, r.reason?.message);
      errors++;
      continue;
    }

    // Dedup di memory dulu (same run)
    const seen = new Set();
    for (const job of r.value) {
      if (!job.url || seen.has(job.url)) { skipped++; continue; }
      seen.add(job.url);
      try {
        await insertNewJob({ ...job, source: src.id, sourceLabel: src.label });
        inserted++;
      } catch (e) {
        console.warn(`[scrape] insert gagal (${job.url}):`, e.message);
        errors++;
      }
    }
  }

  console.log(`[scrape] done: +${inserted} baru, ${skipped} skip (duplikat), ${errors} error`);
}
