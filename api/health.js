module.exports = async (req, res) => {
  res.status(200).json({ ok: true, hasApiKey: Boolean(process.env.GEMINI_API_KEY) });
};
