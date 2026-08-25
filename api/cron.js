/**
 * api/cron.js — Dipanggil cron-job.org tiap 5 menit.
 * Dilindungi x-cron-secret header.
 *
 * FLOW:
 *  1. Respond 200 LANGSUNG → cron-job.org tidak timeout
 *  2. Background: scrape → AI match → upsert DB → email baru → reminder
 */

const { CRON_SOURCES } = require("../lib/sources");
const { matchJobs }    = require("../lib/matcher");
const { CV_TEXT }      = require("../lib/cv");
const {
  upsertJob, getUnnotified, markNotified,
  getReminderCandidates, markReminderSent,
} = require("../lib/jobs-store");
const { migrate }            = require("../lib/db");
const { sendJobEmail, sendReminderEmail } = require("../lib/emailer");

const AUTO_KEYWORDS = ["developer", "fullstack", "backend", "nodejs"];
const NOTIFY_MIN_SCORE = 50;

let dbReady = false;

module.exports = async (req, res) => {
  if (req.method !== "POST" && req.method !== "GET") {
    return res.status(405).json({ error: "Method tidak diizinkan" });
  }

  const cronSecret = process.env.CRON_SECRET;
  const incoming   = req.headers["x-cron-secret"] || req.query?.secret;
  if (cronSecret && incoming !== cronSecret) {
    return res.status(401).json({ error: "Unauthorized — invalid cron secret." });
  }

  const runAt = new Date().toISOString();

  // ── Respond langsung supaya cron-job.org tidak timeout (30 detik) ──────
  res.status(200).json({ ok: true, runAt, message: "Cron started." });

  // ── Lanjut di background ───────────────────────────────────────────────
  runBackground(runAt).catch((err) => console.error("[cron] background error:", err));
};

async function runBackground(runAt) {
  console.log(`[cron] background started ${runAt}`);

  // Init DB
  if (!dbReady) {
    await migrate();
    dbReady = true;
  }

  // 1. SCRAPE — semua sumber paralel, rotasi keyword
  const allJobs = [];
  const scraped = await Promise.allSettled(
    CRON_SOURCES.map((src, i) => {
      const kw = AUTO_KEYWORDS[i % AUTO_KEYWORDS.length];
      return src.searchJobs({ keyword: kw, location: "", maxResults: 8 });
    })
  );

  scraped.forEach((r, i) => {
    const src = CRON_SOURCES[i];
    if (r.status === "fulfilled") {
      allJobs.push(...r.value.map((j) => ({ ...j, source: src.id, sourceLabel: src.label })));
    } else {
      console.warn(`[cron] ${src.id} gagal:`, r.reason?.message);
    }
  });

  // Dedup by URL
  const unique = Array.from(
    new Map(allJobs.filter((j) => j.url).map((j) => [j.url, j])).values()
  );
  console.log(`[cron] scraped ${unique.length} unique jobs`);

  if (unique.length === 0) {
    console.log("[cron] tidak ada jobs, skip.");
    return;
  }

  // 2. AI MATCH — batch paralel
  let scored = [];
  try {
    scored = await matchJobs({ cvText: CV_TEXT, jobs: unique.slice(0, 20) });
  } catch (err) {
    console.error("[cron] AI match gagal:", err.message);
    // Lanjut tanpa score — simpan dengan score 0
    scored = unique.map((j) => ({ ...j, matchScore: 0 }));
  }

  // 3. UPSERT ke DB
  for (const job of scored) {
    try { await upsertJob(job); } catch (err) {
      console.warn(`[cron] upsert gagal (${job.url}):`, err.message);
    }
  }

  // 4. EMAIL — kirim job baru (belum pernah dikirim, score >= 50)
  const toNotify = await getUnnotified(NOTIFY_MIN_SCORE);
  console.log(`[cron] ${toNotify.length} jobs to notify`);

  if (toNotify.length > 0) {
    try {
      await sendJobEmail(toNotify.map(parseForEmail), {
        totalScraped: unique.length,
        sources: CRON_SOURCES.map((s) => s.label),
        runAt,
      });
      await markNotified(toNotify.map((j) => j.url));
      console.log("[cron] notification email sent");
    } catch (err) {
      console.error("[cron] email gagal:", err.message);
    }
  }

  // 5. REMINDER — job score >= 80, masih pending, sudah > 3 hari
  const reminders = await getReminderCandidates();
  console.log(`[cron] ${reminders.length} reminder candidates`);

  if (reminders.length > 0) {
    try {
      await sendReminderEmail(reminders.map(parseForEmail), { runAt });
      await markReminderSent(reminders.map((j) => j.url));
      console.log("[cron] reminder email sent");
    } catch (err) {
      console.error("[cron] reminder email gagal:", err.message);
    }
  }

  console.log("[cron] background selesai");
}

function parseForEmail(j) {
  const tryParse = (v) => { try { return JSON.parse(v); } catch { return []; } };
  return {
    ...j,
    matchScore:    Number(j.match_score) || 0,
    chanceLabel:   j.chance_label,
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
