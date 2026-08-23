const { searchJobs } = require("../lib/scraper");

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method tidak diizinkan" });
  }

  try {
    const { keyword, location } = req.body || {};
    if (!keyword || !keyword.trim()) {
      return res.status(400).json({ error: "keyword wajib diisi" });
    }
    const jobs = await searchJobs({ keyword, location });
    res.status(200).json({ jobs });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message, code: err.code || null });
  }
};
