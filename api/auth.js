/**
 * api/auth.js — Login endpoint.
 * POST /api/auth { password } → { token }
 */

const { login } = require("../lib/auth");

module.exports = async (req, res) => {
  // CORS untuk local dev
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method tidak diizinkan" });

  const { password } = req.body || {};
  if (!password) return res.status(400).json({ error: "Password wajib diisi." });

  const result = login(password);
  if (!result) {
    // Delay kecil untuk anti-brute force
    await new Promise((r) => setTimeout(r, 500));
    return res.status(401).json({ error: "Password salah." });
  }

  return res.status(200).json(result);
};
