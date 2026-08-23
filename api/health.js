module.exports = async (req, res) => {
  res.status(200).json({ ok: true, hasApiKey: Boolean(process.env.ANTHROPIC_API_KEY) });
};
