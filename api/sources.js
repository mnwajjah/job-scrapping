/**
 * api/sources.js — Daftar semua sumber yang tersedia.
 * Dilindungi JWT auth.
 * GET /api/sources → { sources[] }
 */

const { SOURCES } = require("../lib/sources");
const { requireAuth } = require("../lib/auth");

module.exports = async (req, res) => {
  if (req.method !== "GET") return res.status(405).json({ error: "Method tidak diizinkan" });
  if (!requireAuth(req, res)) return;

  res.status(200).json({
    sources: SOURCES.map((s) => ({
      id: s.id,
      label: s.label,
      usePuppeteer: s.usePuppeteer || false,
      note: s.usePuppeteer ? "Butuh headless browser — mungkin lambat" : null,
    })),
  });
};
