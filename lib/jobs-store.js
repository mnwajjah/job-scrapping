/**
 * lib/jobs-store.js — CRUD operations untuk tabel jobs di Turso.
 *
 * Status values:
 *   "pending"   — belum ditindaklanjuti
 *   "applied"   — sudah daftar
 *   "interview" — dapat interview
 *   "offered"   — dapat tawaran
 *   "rejected"  — ditolak
 *   "skipped"   — tidak tertarik
 */

const db = require("./db");

/**
 * Insert job BARU saja — skip kalau URL sudah ada di DB.
 * Tidak akan overwrite score atau status yang sudah ada.
 */
async function insertNewJob(job) {
  await db.exec(`
    INSERT OR IGNORE INTO jobs (
      url, title, company, location, salary, description,
      source, source_label, scraped_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
  `, [
    job.url,
    job.title,
    job.company || null,
    job.location || null,
    job.salary || null,
    (job.description || "").slice(0, 500),
    job.source,
    job.sourceLabel || job.source_label || job.source,
  ]);
}

/** Update AI score untuk job yang sudah ada di DB. */
async function updateJobScore(job) {
  await db.exec(`
    UPDATE jobs SET
      match_score    = ?,
      chance_label   = ?,
      recommendation = ?,
      reasoning      = ?,
      tech_matched   = ?,
      tech_learn     = ?,
      tech_missing   = ?,
      strengths      = ?,
      gaps           = ?
    WHERE url = ? AND (match_score IS NULL OR match_score = 0)
  `, [
    job.matchScore || 0,
    job.chanceLabel || null,
    job.recommendation || null,
    job.reasoning || null,
    JSON.stringify(job.techStackMatch?.matched  || []),
    JSON.stringify(job.techStackMatch?.canLearn || []),
    JSON.stringify(job.techStackMatch?.missing  || []),
    JSON.stringify(job.strengths || []),
    JSON.stringify(job.gaps     || []),
    job.url,
  ]);
}

/** Ambil jobs yang belum punya AI score (untuk cron match). */
async function getUnscored(limit = 20) {
  return db.run(
    `SELECT * FROM jobs WHERE (match_score IS NULL OR match_score = 0) ORDER BY scraped_at DESC LIMIT ?`,
    [limit]
  );
}

/** (Legacy) Upsert lengkap — dipakai dari dashboard match manual. */
async function upsertJob(job) {
  const techMatched  = JSON.stringify(job.techStackMatch?.matched  || []);
  const techLearn    = JSON.stringify(job.techStackMatch?.canLearn || []);
  const techMissing  = JSON.stringify(job.techStackMatch?.missing  || []);
  const strengths    = JSON.stringify(job.strengths || []);
  const gaps         = JSON.stringify(job.gaps      || []);

  await db.exec(`
    INSERT INTO jobs (
      url, title, company, location, salary, description,
      source, source_label,
      match_score, chance_label, recommendation, reasoning,
      tech_matched, tech_learn, tech_missing, strengths, gaps
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(url) DO UPDATE SET
      match_score    = MAX(excluded.match_score, jobs.match_score),
      chance_label   = excluded.chance_label,
      recommendation = excluded.recommendation,
      reasoning      = excluded.reasoning,
      tech_matched   = excluded.tech_matched,
      tech_learn     = excluded.tech_learn,
      tech_missing   = excluded.tech_missing,
      strengths      = excluded.strengths,
      gaps           = excluded.gaps,
      scraped_at     = datetime('now')
  `, [
    job.url, job.title, job.company, job.location, job.salary,
    (job.description || "").slice(0, 500),
    job.source, job.sourceLabel,
    job.matchScore || 0, job.chanceLabel, job.recommendation, job.reasoning,
    techMatched, techLearn, techMissing, strengths, gaps,
  ]);
}

/** Ambil jobs belum dikirim email dengan score >= minScore. */
async function getUnnotified(minScore = 50) {
  return db.run(
    `SELECT * FROM jobs WHERE notified = 0 AND match_score >= ? ORDER BY match_score DESC`,
    [minScore]
  );
}

/** Tandai jobs sebagai sudah dikirim email. */
async function markNotified(urls) {
  if (!urls || urls.length === 0) return;
  const placeholders = urls.map(() => "?").join(",");
  await db.exec(
    `UPDATE jobs SET notified = 1, notified_at = datetime('now') WHERE url IN (${placeholders})`,
    urls
  );
}

/**
 * Ambil kandidat untuk reminder:
 * - score >= 80
 * - status masih "pending"
 * - sudah dikirim email (notified = 1)
 * - notified_at lebih dari 3 hari lalu
 * - reminder belum pernah dikirim ATAU terakhir dikirim > 3 hari lalu
 */
async function getReminderCandidates() {
  return db.run(`
    SELECT * FROM jobs
    WHERE match_score >= 80
      AND status = 'pending'
      AND notified = 1
      AND notified_at <= datetime('now', '-3 days')
      AND (reminder_sent_at IS NULL OR reminder_sent_at <= datetime('now', '-3 days'))
    ORDER BY match_score DESC
    LIMIT 20
  `);
}

/** Tandai reminder sudah dikirim. */
async function markReminderSent(urls) {
  if (!urls || urls.length === 0) return;
  const placeholders = urls.map(() => "?").join(",");
  await db.exec(
    `UPDATE jobs SET reminder_sent_at = datetime('now') WHERE url IN (${placeholders})`,
    urls
  );
}

/** Update status aplikasi (applied, interview, offered, rejected, skipped, pending). */
async function updateStatus(url, status) {
  const VALID = ["pending", "applied", "interview", "offered", "rejected", "skipped"];
  if (!VALID.includes(status)) throw new Error(`Status tidak valid: ${status}`);
  await db.exec(
    `UPDATE jobs SET status = ?, status_updated_at = datetime('now') WHERE url = ?`,
    [status, url]
  );
}

/**
 * Ambil jobs untuk dashboard.
 * @param {object} opts - { status?, minScore?, limit?, offset? }
 */
async function getJobs({ status, minScore = 0, limit = 50, offset = 0 } = {}) {
  const conditions = [`match_score >= ?`];
  const args = [minScore];

  if (status && status !== "all") {
    conditions.push(`status = ?`);
    args.push(status);
  }

  args.push(limit, offset);

  return db.run(`
    SELECT * FROM jobs
    WHERE ${conditions.join(" AND ")}
    ORDER BY match_score DESC, scraped_at DESC
    LIMIT ? OFFSET ?
  `, args);
}

/** Statistik ringkas untuk dashboard. */
async function getStats() {
  const row = await db.first(`
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN match_score >= 80 THEN 1 ELSE 0 END) as high,
      SUM(CASE WHEN match_score >= 50 AND match_score < 80 THEN 1 ELSE 0 END) as medium,
      SUM(CASE WHEN status = 'applied' THEN 1 ELSE 0 END) as applied,
      SUM(CASE WHEN status = 'interview' THEN 1 ELSE 0 END) as interview,
      SUM(CASE WHEN status = 'offered' THEN 1 ELSE 0 END) as offered,
      SUM(CASE WHEN status = 'pending' AND match_score >= 70 THEN 1 ELSE 0 END) as action_needed
    FROM jobs
  `);
  return row;
}

module.exports = {
  insertNewJob,
  updateJobScore,
  getUnscored,
  upsertJob,
  getUnnotified,
  markNotified,
  getReminderCandidates,
  markReminderSent,
  updateStatus,
  getJobs,
  getStats,
};
