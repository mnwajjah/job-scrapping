/**
 * server.js — Local dev server untuk testing sebelum deploy Vercel.
 * Jalankan: node server.js
 * Buka: http://localhost:3000
 */

const http = require("http");
const fs = require("fs");
const path = require("path");
const url = require("url");

// Simulasi Vercel body parsing
function parseBody(req) {
  return new Promise((resolve) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      try { resolve(JSON.parse(body)); }
      catch { resolve({}); }
    });
  });
}

// Mock Vercel req/res
function makeVercelReq(req, body, query) {
  return { method: req.method, headers: req.headers, body, query: query || {} };
}

function makeVercelRes(res) {
  let sent = false;
  const vRes = {
    status(code) { res.statusCode = code; return vRes; },
    json(data) {
      if (sent) return;
      sent = true;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify(data));
    },
    end() { if (!sent) { sent = true; res.end(); } },
    setHeader(k, v) { res.setHeader(k, v); return vRes; },
  };
  return vRes;
}

const MIME = {
  ".html": "text/html",
  ".css": "text/css",
  ".js": "application/javascript",
  ".txt": "text/plain",
  ".json": "application/json",
};

const server = http.createServer(async (req, res) => {
  const parsed = url.parse(req.url, true);
  const pathname = parsed.pathname;

  // API routes
  if (pathname.startsWith("/api/")) {
    const segment = pathname.slice(5).split("/")[0]; // e.g. "auth", "search"
    const handlerPath = path.join(__dirname, "api", `${segment}.js`);
    if (fs.existsSync(handlerPath)) {
      delete require.cache[require.resolve(handlerPath)];
      const handler = require(handlerPath);
      const body = await parseBody(req);
      const vReq = makeVercelReq(req, body, parsed.query);
      const vRes = makeVercelRes(res);
      try { await handler(vReq, vRes); }
      catch (err) { vRes.status(500).json({ error: err.message }); }
      return;
    }
  }

  // Static files
  let filePath = path.join(__dirname, "public", pathname === "/" ? "index.html" : pathname);
  if (!fs.existsSync(filePath)) filePath = path.join(__dirname, "public", "index.html");

  const ext = path.extname(filePath);
  res.setHeader("Content-Type", MIME[ext] || "application/octet-stream");
  fs.createReadStream(filePath).pipe(res);
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`\n🚀 Cocok v2 dev server running at http://localhost:${PORT}\n`);
  console.log("  ENV vars dibutuhkan:");
  console.log("  GEMINI_API_KEY, RESEND_API_KEY, EMAIL_TO, EMAIL_FROM");
  console.log("  DASHBOARD_PASSWORD (default: wajjah2026)");
  console.log("  JWT_SECRET, CRON_SECRET\n");
});
