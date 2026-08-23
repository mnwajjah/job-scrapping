// 2026-07-06 support multi-source: jobstreet, hennge, glints, mercari
const { BY_ID } = require("../lib/sources");

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method tidak diizinkan" });
  }

  try {
    const { keyword, location, sources } = req.body || {};
    if (!keyword || !keyword.trim()) {
      return res.status(400).json({ error: "keyword wajib diisi" });
    }

    const ids = Array.isArray(sources) && sources.length ? sources : ["jobstreet"];
    const selected = ids.map((id) => BY_ID[id]).filter(Boolean);
    if (selected.length === 0) {
      return res.status(400).json({ error: `sumber tidak dikenal: ${ids.join(", ")}` });
    }

    const results = await Promise.allSettled(
      selected.map((src) => src.searchJobs({ keyword, location, maxResults: 20 }))
    );

    const jobs = [];
    const errors = [];
    results.forEach((r, i) => {
      const src = selected[i];
      if (r.status === "fulfilled") {
        jobs.push(...r.value.map((j) => ({ ...j, source: src.id, sourceLabel: src.label })));
      } else {
        errors.push({ source: src.id, label: src.label, message: r.reason.message, code: r.reason.code || null });
      }
    });

    if (jobs.length === 0) {
      return res.status(500).json({ error: "Semua sumber gagal.", errors });
    }

    res.status(200).json({ jobs, errors });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message, code: err.code || null });
  }
};
