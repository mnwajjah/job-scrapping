// 2026-07-06 daftar sumber untuk dropdown/checkbox frontend
const { SOURCES } = require("../lib/sources");

module.exports = async (req, res) => {
  res.status(200).json({
    sources: SOURCES.map((s) => ({ id: s.id, label: s.label })),
  });
};
