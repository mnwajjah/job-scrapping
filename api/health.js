/**
 * api/health.js — Health check endpoint (public, tidak butuh auth).
 * GET /api/health
 */

module.exports = async (req, res) => {
  res.status(200).json({
    ok: true,
    service: "Cocok Job Scraper v2",
    timestamp: new Date().toISOString(),
    env: {
      hasGeminiKey: !!process.env.GEMINI_API_KEY,
      hasResendKey: !!process.env.RESEND_API_KEY,
      hasEmailTo: !!process.env.EMAIL_TO,
      hasCronSecret: !!process.env.CRON_SECRET,
      hasJwtSecret: !!process.env.JWT_SECRET,
      hasPassword: !!process.env.DASHBOARD_PASSWORD,
    },
  });
};
