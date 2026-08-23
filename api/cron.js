/**
 * api/cron.js — Endpoint yang dipanggil cron-job.org tiap 5 menit.
 * Dilindungi header x-cron-secret (diset di env CRON_SECRET).
 *
 * Flow:
 * 1. Validasi x-cron-secret
 * 2. Scrape semua sumber (non-Puppeteer) dengan keyword dari CV Wajjah
 * 3. Match dengan CV Wajjah via AI
 * 4. Filter job dengan score >= 50
 * 5. Kirim email kalau ada job baru
 */

const { CRON_SOURCES } = require("../lib/sources");
const { matchJobs } = require("../lib/matcher");
const { sendJobEmail } = require("../lib/emailer");
const { CV_TEXT } = require("../lib/cv");

// Keywords yang relevan dengan CV Wajjah — otomatis scrape ini
const AUTO_KEYWORDS = [
  "fullstack developer",
  "backend developer",
  "nodejs developer",
  "react developer",
  "php developer",
  "web developer",
];

// Seen URLs in-memory (Vercel stateless — pakai simple dedup by this run)
// Email dedup dilakukan via content, bukan persistent state
const SCORE_THRESHOLD = 50;

module.exports = async (req, res) => {
  if (req.method !== "POST" && req.method !== "GET") {
    return res.status(405).json({ error: "Method tidak diizinkan" });
  }

  // Validasi cron secret
  const cronSecret = process.env.CRON_SECRET;
  const incomingSecret = req.headers["x-cron-secret"] || req.query?.secret;
  if (cronSecret && incomingSecret !== cronSecret) {
    return res.status(401).json({ error: "Unauthorized — invalid cron secret." });
  }

  const runAt = new Date().toISOString();
  console.log(`[cron] run started at ${runAt}`);

  try {
    // 1. Scrape semua sumber dengan berbagai keyword
    const allJobs = [];
    const errors = [];

    for (const kw of AUTO_KEYWORDS) {
      const results = await Promise.allSettled(
        CRON_SOURCES.map((src) =>
          src.searchJobs({ keyword: kw, location: "", maxResults: 10 })
        )
      );

      results.forEach((r, i) => {
        const src = CRON_SOURCES[i];
        if (r.status === "fulfilled") {
          allJobs.push(...r.value.map((j) => ({ ...j, source: src.id, sourceLabel: src.label })));
        } else {
          errors.push({ source: src.id, keyword: kw, message: r.reason?.message });
        }
      });
    }

    // Deduplikasi by URL
    const uniqueJobs = Array.from(new Map(allJobs.filter((j) => j.url).map((j) => [j.url, j])).values());
    console.log(`[cron] scraped ${uniqueJobs.length} unique jobs, ${errors.length} errors`);

    if (uniqueJobs.length === 0) {
      return res.status(200).json({
        ok: true,
        runAt,
        totalScraped: 0,
        matched: 0,
        emailSent: false,
        errors,
        message: "Tidak ada lowongan berhasil di-scrape.",
      });
    }

    // 2. Match dengan CV Wajjah (batasi max 30 job untuk hemat API call)
    const jobsToMatch = uniqueJobs.slice(0, 30);
    const scored = await matchJobs({ cvText: CV_TEXT, jobs: jobsToMatch });

    // 3. Filter yang relevant
    const goodJobs = scored
      .filter((j) => j.matchScore >= SCORE_THRESHOLD)
      .sort((a, b) => b.matchScore - a.matchScore);

    console.log(`[cron] ${goodJobs.length} jobs with score >= ${SCORE_THRESHOLD}`);

    // 4. Kirim email kalau ada
    let emailResult = { skipped: true };
    if (goodJobs.length > 0) {
      emailResult = await sendJobEmail(goodJobs, {
        totalScraped: uniqueJobs.length,
        sources: CRON_SOURCES.map((s) => s.label),
        runAt,
      });
    }

    return res.status(200).json({
      ok: true,
      runAt,
      totalScraped: uniqueJobs.length,
      matched: goodJobs.length,
      emailSent: emailResult.sent || false,
      emailSkipped: emailResult.skipped || false,
      errors: errors.length > 0 ? errors : undefined,
      topJobs: goodJobs.slice(0, 5).map((j) => ({
        title: j.title,
        company: j.company,
        score: j.matchScore,
        chanceLabel: j.chanceLabel,
        url: j.url,
      })),
    });
  } catch (err) {
    console.error("[cron] fatal error:", err);
    return res.status(500).json({ ok: false, error: err.message, runAt });
  }
};
