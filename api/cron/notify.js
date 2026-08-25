/**
 * api/cron/notify.js — Cron #3: Kirim email notifikasi + reminder.
 * Jadwal: tiap 15 menit, offset 7 menit  (7-59/15 * * * *)
 *
 * Tugas:
 *  - Ambil jobs: notified=0, score >= 50 → kirim email notifikasi baru
 *  - Mark notified=1 setelah kirim
 *  - Cek reminder: score >= 80, status=pending, > 3 hari → kirim reminder
 */

const {
  getUnnotified, markNotified,
  getReminderCandidates, markReminderSent,
} = require("../../lib/jobs-store");
const { sendJobEmail, sendReminderEmail } = require("../../lib/emailer");
const { migrate } = require("../../lib/db");

const NOTIFY_MIN_SCORE = 50;

let dbReady = false;

function checkSecret(req) {
  const secret = process.env.CRON_SECRET;
  const incoming = req.headers["x-cron-secret"] || req.query?.secret;
  return !secret || incoming === secret;
}

function parseForEmail(j) {
  const tryParse = (v) => { try { return JSON.parse(v); } catch { return []; } };
  return {
    ...j,
    matchScore:    Number(j.match_score) || 0,
    chanceLabel:   j.chance_label,
    recommendation: j.recommendation,
    sourceLabel:   j.source_label,
    techStackMatch: {
      matched:  tryParse(j.tech_matched),
      canLearn: tryParse(j.tech_learn),
      missing:  tryParse(j.tech_missing),
    },
    strengths: tryParse(j.strengths),
    gaps:      tryParse(j.gaps),
  };
}

module.exports = async (req, res) => {
  if (req.method !== "POST" && req.method !== "GET")
    return res.status(405).json({ error: "Method tidak diizinkan" });
  if (!checkSecret(req))
    return res.status(401).json({ error: "Unauthorized — invalid cron secret." });

  if (!dbReady) {
    try { await migrate(); dbReady = true; }
    catch (err) { return res.status(500).json({ error: "DB error: " + err.message }); }
  }

  const runAt = new Date().toISOString();
  const result = { runAt, step: "notify", notifications: 0, reminders: 0, emailsSent: 0 };

  // 1. Notifikasi job baru
  const toNotify = await getUnnotified(NOTIFY_MIN_SCORE);
  result.notifications = toNotify.length;
  console.log(`[notify] ${toNotify.length} jobs to notify`);

  if (toNotify.length > 0) {
    try {
      const sources = [...new Set(toNotify.map((j) => j.source_label || j.source))];
      await sendJobEmail(toNotify.map(parseForEmail), {
        totalScraped: toNotify.length,
        sources,
        runAt,
      });
      await markNotified(toNotify.map((j) => j.url));
      result.emailsSent++;
      console.log("[notify] notification email sent");
    } catch (err) {
      console.error("[notify] gagal kirim email:", err.message);
    }
  }

  // 2. Reminder untuk job score >= 80 belum dilamar
  const reminders = await getReminderCandidates();
  result.reminders = reminders.length;
  console.log(`[notify] ${reminders.length} reminder candidates`);

  if (reminders.length > 0) {
    try {
      await sendReminderEmail(reminders.map(parseForEmail), { runAt });
      await markReminderSent(reminders.map((j) => j.url));
      result.emailsSent++;
      console.log("[notify] reminder email sent");
    } catch (err) {
      console.error("[notify] gagal kirim reminder:", err.message);
    }
  }

  return res.status(200).json({ ok: true, ...result });
};
