const { matchJobs } = require("../lib/matcher");

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method tidak diizinkan" });
  }

  try {
    if (!process.env.ANTHROPIC_API_KEY) {
      return res.status(400).json({
        error: "ANTHROPIC_API_KEY belum diset di Environment Variables Vercel.",
      });
    }
    const { cvText, jobs } = req.body || {};
    if (!cvText || !cvText.trim()) {
      return res.status(400).json({ error: "cvText wajib diisi" });
    }
    if (!Array.isArray(jobs) || jobs.length === 0) {
      return res.status(400).json({ error: "jobs wajib diisi (minimal 1 lowongan)" });
    }
    const scored = await matchJobs({ cvText, jobs });
    res.status(200).json({ jobs: scored });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
};
