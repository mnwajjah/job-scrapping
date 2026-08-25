/**
 * api/debug-db.js — Debugging database Turso secara langsung dari browser.
 * GET /api/debug-db?action=schema
 * GET /api/debug-db?action=list
 * GET /api/debug-db?action=insertTest
 */

const db = require("../lib/db");
const { requireAuth } = require("../lib/auth");

module.exports = async (req, res) => {
  // Biarkan public untuk mempermudah debug, tapi cek password parameter jika diset
  const secret = req.query.secret;
  if (process.env.CRON_SECRET && secret !== process.env.CRON_SECRET) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const action = req.query.action || "status";

  try {
    await db.migrate();

    if (action === "status") {
      const row = await db.first("SELECT COUNT(*) as count FROM jobs");
      return res.status(200).json({
        ok: true,
        message: "Koneksi database aktif.",
        jobCount: Number(row?.count) || 0,
        config: {
          dbUrl: process.env.TURSO_DATABASE_URL || "not_set",
          dbTokenMasked: process.env.TURSO_AUTH_TOKEN
            ? process.env.TURSO_AUTH_TOKEN.slice(0, 10) + "..."
            : "not_set",
        }
      });
    }

    if (action === "schema") {
      // Dapatkan skema tabel SQLite
      const tables = await db.run("SELECT name, sql FROM sqlite_master WHERE type='table'");
      return res.status(200).json({ ok: true, tables });
    }

    if (action === "list") {
      // Ambil 5 record pertama
      const rows = await db.run("SELECT * FROM jobs LIMIT 5");
      return res.status(200).json({ ok: true, count: rows.length, jobs: rows });
    }

    if (action === "insertTest") {
      // Coba lakukan insert data test
      const testUrl = `https://test-job-${Date.now()}.com`;
      await db.exec(`
        INSERT INTO jobs (url, title, company, source)
        VALUES (?, ?, ?, ?)
      `, [testUrl, "Test Engineer", "Test Company LLC", "test"]);

      const check = await db.first("SELECT * FROM jobs WHERE url = ?", [testUrl]);
      return res.status(200).json({
        ok: true,
        message: "Insert data test sukses!",
        insertedJob: check,
      });
    }

    if (action === "clear") {
      // Hapus semua data (untuk testing)
      await db.exec("DELETE FROM jobs");
      return res.status(200).json({ ok: true, message: "Semua data jobs berhasil dihapus." });
    }

    return res.status(400).json({ error: `Action tidak dikenal: ${action}` });

  } catch (err) {
    console.error("[debug-db] error:", err);
    return res.status(500).json({
      ok: false,
      error: err.message,
      stack: err.stack,
    });
  }
};
