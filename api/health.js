const db = require("../lib/db");

module.exports = async (req, res) => {
  let dbStatus = "not_configured";
  let jobCount = 0;
  let dbError = null;

  if (process.env.TURSO_DATABASE_URL && process.env.TURSO_AUTH_TOKEN) {
    try {
      // Lazy migrate / check table
      await db.migrate();
      const row = await db.first("SELECT COUNT(*) as count FROM jobs");
      dbStatus = "connected";
      jobCount = Number(row?.count) || 0;
    } catch (err) {
      dbStatus = "error";
      dbError = err.message;
    }
  }

  res.status(200).json({
    ok: true,
    service: "Cocok Job Scraper v3",
    timestamp: new Date().toISOString(),
    database: {
      status: dbStatus,
      jobCount,
      error: dbError,
    },
    env: {
      hasGeminiKey: !!process.env.GEMINI_API_KEY,
      hasResendKey: !!process.env.RESEND_API_KEY,
      hasEmailTo: !!process.env.EMAIL_TO,
      hasCronSecret: !!process.env.CRON_SECRET,
      hasJwtSecret: !!process.env.JWT_SECRET,
      hasPassword: !!process.env.DASHBOARD_PASSWORD,
      hasTursoUrl: !!process.env.TURSO_DATABASE_URL,
      hasTursoToken: !!process.env.TURSO_AUTH_TOKEN,
    },
  });
};
