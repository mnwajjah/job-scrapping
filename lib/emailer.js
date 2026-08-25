/**
 * lib/emailer.js — Kirim email via Resend REST API.
 * Env: RESEND_API_KEY, EMAIL_FROM, EMAIL_TO
 */

const RESEND_API = "https://api.resend.com/emails";

function escHtml(str) {
  return String(str || "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function scoreColor(s) {
  return s >= 70 ? "#22c55e" : s >= 50 ? "#f59e0b" : "#ef4444";
}

function jobRow(j) {
  const sc   = Number(j.matchScore) || 0;
  const col  = scoreColor(sc);
  const matched = (j.techStackMatch?.matched  || []).join(", ") || "—";
  const learn   = (j.techStackMatch?.canLearn || []).join(", ") || "—";
  const missing = (j.techStackMatch?.missing  || []).join(", ") || "—";
  return `
  <tr style="border-bottom:1px solid #2a2a2a">
    <td style="padding:12px 8px">
      <a href="${j.url||"#"}" style="color:#60a5fa;font-weight:600;text-decoration:none">${escHtml(j.title)}</a><br/>
      <span style="color:#9ca3af;font-size:12px">${escHtml(j.company||"")} · ${escHtml(j.location||"")}</span>
      ${j.salary ? `<br/><span style="color:#86efac;font-size:12px">💰 ${escHtml(j.salary)}</span>` : ""}
      <br/><span style="color:#6b7280;font-size:11px">${escHtml(j.sourceLabel||j.source||"")}</span>
    </td>
    <td style="padding:12px 8px;text-align:center;white-space:nowrap">
      <span style="background:${col};color:#fff;border-radius:20px;padding:4px 10px;font-weight:700">${sc}%</span><br/>
      <span style="color:#9ca3af;font-size:11px">${escHtml(j.chanceLabel||"")}</span>
    </td>
    <td style="padding:12px 8px;font-size:12px;color:#d1d5db">
      ✅ ${escHtml(matched)}<br/>📚 ${escHtml(learn)}<br/>❌ ${escHtml(missing)}
    </td>
    <td style="padding:12px 8px;font-size:12px;color:#d1d5db">
      ${escHtml(j.reasoning||"—")}<br/>
      <strong style="color:${col}">${escHtml(j.recommendation||"")}</strong>
    </td>
  </tr>`;
}

function emailWrapper(title, subtitle, tableRows, footer) {
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"/></head>
<body style="background:#0f0f0f;color:#e5e7eb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;margin:0;padding:20px">
<div style="max-width:900px;margin:0 auto">
  <h1 style="color:#60a5fa;margin-bottom:4px">${title}</h1>
  <p style="color:#9ca3af;margin-top:0">${subtitle}</p>
  <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;background:#1a1a1a;border-radius:8px;overflow:hidden">
    <thead><tr style="background:#222">
      <th style="padding:12px 8px;text-align:left;color:#60a5fa;font-size:13px">Lowongan</th>
      <th style="padding:12px 8px;color:#60a5fa;font-size:13px">Match %</th>
      <th style="padding:12px 8px;text-align:left;color:#60a5fa;font-size:13px">Tech Stack</th>
      <th style="padding:12px 8px;text-align:left;color:#60a5fa;font-size:13px">Analisis AI</th>
    </tr></thead>
    <tbody>${tableRows}</tbody>
  </table>
  <p style="color:#6b7280;font-size:12px;margin-top:16px;text-align:center">${footer}</p>
</div></body></html>`;
}

function formatDate(iso) {
  return new Date(iso).toLocaleString("id-ID", {
    timeZone: "Asia/Jakarta", dateStyle: "full", timeStyle: "short",
  });
}

/** Email notifikasi job baru. */
async function sendJobEmail(jobs, meta) {
  const apiKey = process.env.RESEND_API_KEY;
  const from   = process.env.EMAIL_FROM || "noreply@resend.dev";
  const to     = process.env.EMAIL_TO;
  if (!apiKey || !to) { console.warn("[emailer] skip — env tidak lengkap"); return { skipped: true }; }

  const rows = jobs.map(jobRow).join("");
  const runTime = formatDate(meta.runAt);
  const subject = `🎯 ${jobs.length} Lowongan Baru Cocok — ${new Date(meta.runAt).toLocaleDateString("id-ID")}`;
  const html = emailWrapper(
    "🎯 Job Match Report",
    `${runTime} · ${meta.totalScraped} lowongan di-scrape · ${jobs.length} cocok (skor ≥ 50%)`,
    rows,
    `Dikirim otomatis oleh <strong>Cocok Job Scraper</strong> · Buka dashboard untuk tandai status lamaran`
  );

  return sendEmail({ apiKey, from, to, subject, html });
}

/** Email reminder 3 hari — job score ≥ 80 belum ditindaklanjuti. */
async function sendReminderEmail(jobs, meta) {
  const apiKey = process.env.RESEND_API_KEY;
  const from   = process.env.EMAIL_FROM || "noreply@resend.dev";
  const to     = process.env.EMAIL_TO;
  if (!apiKey || !to) { console.warn("[emailer] reminder skip — env tidak lengkap"); return { skipped: true }; }

  const rows = jobs.map(jobRow).join("");
  const subject = `⏰ Reminder: ${jobs.length} Lowongan Terbaik Belum Kamu Lamar!`;
  const html = emailWrapper(
    "⏰ Reminder Lamaran",
    `${jobs.length} lowongan dengan skor ≥ 80% belum kamu tindaklanjuti. Jangan sampai kelewatan!`,
    rows,
    `Buka dashboard untuk tandai "Sudah Daftar" atau "Tidak Tertarik"`
  );

  return sendEmail({ apiKey, from, to, subject, html });
}

async function sendEmail({ apiKey, from, to, subject, html }) {
  const resp = await fetch(RESEND_API, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from, to, subject, html }),
  });
  const data = await resp.json();
  if (!resp.ok) throw new Error(`Resend error: ${JSON.stringify(data)}`);
  return { sent: true, id: data.id };
}

module.exports = { sendJobEmail, sendReminderEmail };
