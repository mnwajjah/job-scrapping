/**
 * lib/auth.js — JWT sign & verify untuk dashboard protection.
 * Secret diambil dari env var JWT_SECRET.
 */

const jwt = require("jsonwebtoken");

const SECRET = process.env.JWT_SECRET || "cocok-fallback-secret-ganti-di-vercel";
const PASSWORD = process.env.DASHBOARD_PASSWORD || "wajjah2026";
const EXPIRES_IN = "7d";

/**
 * Verifikasi password, kembalikan JWT token kalau valid.
 * @param {string} password
 * @returns {{ token: string } | null}
 */
function login(password) {
  if (password !== PASSWORD) return null;
  const token = jwt.sign({ sub: "wajjah", role: "owner" }, SECRET, { expiresIn: EXPIRES_IN });
  return { token };
}

/**
 * Verifikasi JWT token dari header Authorization.
 * Kembalikan payload kalau valid, null kalau tidak.
 * @param {string} authHeader — "Bearer <token>"
 * @returns {object | null}
 */
function verifyToken(authHeader) {
  if (!authHeader || !authHeader.startsWith("Bearer ")) return null;
  const token = authHeader.slice(7);
  try {
    return jwt.verify(token, SECRET);
  } catch {
    return null;
  }
}

/**
 * Middleware-style guard untuk Vercel serverless.
 * Kalau tidak terautentikasi, langsung kembalikan 401.
 * @returns {boolean} true = lanjut, false = sudah reply 401
 */
function requireAuth(req, res) {
  const payload = verifyToken(req.headers["authorization"] || "");
  if (!payload) {
    res.status(401).json({ error: "Unauthorized — login dulu." });
    return false;
  }
  return true;
}

module.exports = { login, verifyToken, requireAuth };
