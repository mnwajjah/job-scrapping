const Anthropic = require("@anthropic-ai/sdk");

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const MODEL = "claude-sonnet-4-6";

function buildPrompt({ cvText, job }) {
  return `Kamu adalah asisten rekrutmen. Nilai seberapa cocok kandidat berikut untuk lowongan ini.

=== CV KANDIDAT ===
${cvText}

=== LOWONGAN ===
Judul: ${job.title}
Perusahaan: ${job.company || "-"}
Lokasi: ${job.location || "-"}
Deskripsi: ${job.description || "-"}

Balas HANYA dengan JSON valid (tanpa markdown, tanpa teks lain), format persis:
{
  "score": <angka 0-100, seberapa cocok kandidat dengan lowongan ini>,
  "reasoning": "<1-2 kalimat alasan singkat dalam Bahasa Indonesia>",
  "strengths": ["<poin kecocokan 1>", "<poin kecocokan 2>"],
  "gaps": ["<poin kekurangan/gap 1>"]
}`;
}

async function matchOneJob({ cvText, job }) {
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 500,
    messages: [{ role: "user", content: buildPrompt({ cvText, job }) }],
  });

  const textBlock = response.content.find((b) => b.type === "text");
  const raw = textBlock ? textBlock.text.trim() : "{}";
  const cleaned = raw.replace(/^```json\s*|```$/g, "").trim();

  let parsed;
  try {
    parsed = JSON.parse(cleaned);
  } catch (e) {
    parsed = { score: 0, reasoning: "Gagal menilai (respons AI tidak valid).", strengths: [], gaps: [] };
  }

  return {
    ...job,
    matchScore: typeof parsed.score === "number" ? parsed.score : 0,
    reasoning: parsed.reasoning || "",
    strengths: parsed.strengths || [],
    gaps: parsed.gaps || [],
  };
}

/**
 * Cocokkan CV terhadap daftar lowongan.
 * Dijalankan dengan concurrency terbatas biar tidak kena rate limit.
 */
async function matchJobs({ cvText, jobs, concurrency = 3 }) {
  const results = new Array(jobs.length);
  let idx = 0;

  async function worker() {
    while (idx < jobs.length) {
      const current = idx++;
      try {
        results[current] = await matchOneJob({ cvText, job: jobs[current] });
      } catch (err) {
        results[current] = {
          ...jobs[current],
          matchScore: 0,
          reasoning: `Gagal menilai: ${err.message}`,
          strengths: [],
          gaps: [],
        };
      }
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, jobs.length) }, worker);
  await Promise.all(workers);

  return results.sort((a, b) => b.matchScore - a.matchScore);
}

module.exports = { matchJobs, matchOneJob };
