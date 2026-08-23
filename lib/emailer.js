/**
 * lib/emailer.js — Kirim email via Resend REST API.
 * Tidak butuh SDK, cukup native fetch.
 * Env: RESEND_API_KEY, EMAIL_FROM, EMAIL_TO
 */

const RESEND_API = "https://api.resend.com/emails";

/**
 * Buat HTML email dari daftar jobs yang sudah di-score.
 * @param {Array} jobs
 * @param {object} meta — { totalScraped, sources, runAt }
 * @returns {string} HTML string
 */
function buildEmailHtml(jobs, meta) {
  const rows = jobs
    .map((j) => {
      const scoreColor =
        j.matchScore >= 70 ? "#22c55e" : j.matchScore >= 50 ? "#f59e0b" : "#ef4444";
      const techMatched = (j.techStackMatch?.matched || []).join(", ") || "-";
      const techLearn = (j.techStackMatch?.canLearn || []).join(", ") || "-";
      const techMissing = (j.techStackMatch?.missing || []).join(", ") || "-";

      return `
      <tr style="border-bottom:1px solid #2a2a2a">
        <td style="padding:12px 8px">
          <a href="${j.url || "#"}" style="color:#60a5fa;text-decoration:none;font-weight:600">${escHtml(j.title)}</a>
          <br/><span style="color:#9ca3af;font-size:12px">${escHtml(j.company || "")} · ${escHtml(j.location || "")}</span>
          ${j.salary ? `<br/><span style="color:#86efac;font-size:12px">💰 ${escHtml(j.salary)}</span>` : ""}
          <br/><span style="color:#d1d5db;font-size:12px;display:block;margin-top:4px">${escHtml(j.sourceLabel || "")}</span>
        </td>
        <td style="padding:12px 8px;text-align:center">
          <span style="background:${scoreColor};color:#fff;border-radius:20px;padding:4px 10px;font-weight:700;font-size:14px">${j.matchScore}%</span>
          <br/><span style="color:#9ca3af;font-size:11px">${escHtml(j.chanceLabel || "")}</span>
        </td>
        <td style="padding:12px 8px;font-size:12px;color:#d1d5db">
          ✅ ${escHtml(techMatched)}<br/>
          📚 ${escHtml(techLearn)}<br/>
          ❌ ${escHtml(techMissing)}
        </td>
        <td style="padding:12px 8px;font-size:12px;color:#d1d5db">
          ${escHtml(j.reasoning || "-")}
          <br/><strong style="color:${scoreColor}">${escHtml(j.recommendation || "")}</strong>
        </td>
      </tr>`;
    })
    .join("");

  const runTime = new Date(meta.runAt).toLocaleString("id-ID", {
    timeZone: "Asia/Jakarta",
    dateStyle: "full",
    timeStyle: "short",
  });

  return `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"/></head>
<body style="background:#0f0f0f;color:#e5e7eb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;margin:0;padding:20px">
  <div style="max-width:900px;margin:0 auto">
    <h1 style="color:#60a5fa;margin-bottom:4px">🎯 Job Match Report</h1>
    <p style="color:#9ca3af;margin-top:0">${runTime} · ${meta.totalScraped} lowongan di-scrape · ${jobs.length} match (skor ≥ 50%) · Sumber: ${escHtml(meta.sources.join(", "))}</p>

    <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;background:#1a1a1a;border-radius:8px;overflow:hidden">
      <thead>
        <tr style="background:#222">
          <th style="padding:12px 8px;text-align:left;color:#60a5fa;font-size:13px">Lowongan</th>
          <th style="padding:12px 8px;color:#60a5fa;font-size:13px;white-space:nowrap">Match %</th>
          <th style="padding:12px 8px;text-align:left;color:#60a5fa;font-size:13px">Tech Stack</th>
          <th style="padding:12px 8px;text-align:left;color:#60a5fa;font-size:13px">Analisis</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>

    <p style="color:#6b7280;font-size:12px;margin-top:16px;text-align:center">
      Dikirim otomatis oleh <strong>Cocok Job Scraper</strong> · Hanya job dengan skor ≥ 50% yang dikirim
    </p>
  </div>
</body>
</html>`;
}

function escHtml(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Kirim email dengan daftar job yang match.
 * @param {Array} jobs — jobs yang sudah di-score (matchScore >= 50)
 * @param {object} meta — { totalScraped, sources, runAt }
 */
async function sendJobEmail(jobs, meta) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM || "noreply@resend.dev";
  const to = process.env.EMAIL_TO;

  if (!apiKey || !to) {
    console.warn("[emailer] RESEND_API_KEY atau EMAIL_TO belum diset — skip email.");
    return { skipped: true };
  }

  const subject = `🎯 ${jobs.length} Lowongan Cocok Ditemukan — ${new Date(meta.runAt).toLocaleDateString("id-ID")}`;
  const html = buildEmailHtml(jobs, meta);

  const resp = await fetch(RESEND_API, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ from, to, subject, html }),
  });

  const data = await resp.json();
  if (!resp.ok) throw new Error(`Resend error: ${JSON.stringify(data)}`);
  return { sent: true, id: data.id };
}

module.exports = { sendJobEmail };
