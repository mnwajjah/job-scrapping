#!/usr/bin/env node
/**
 * run-auto-apply.js — CLI entry point untuk auto-apply agent.
 *
 * Usage:
 *   node run-auto-apply.js                    # Default: auto-submit, score ≥ 60
 *   node run-auto-apply.js --limit 3          # Limit 3 jobs saja
 *   node run-auto-apply.js --min-score 80     # Hanya score ≥ 80
 *   node run-auto-apply.js --safe             # Pause sebelum submit (confirmation mode)
 *   node run-auto-apply.js --headless         # Tanpa tampilkan browser
 *   node run-auto-apply.js --dry-run          # Analisis saja, jangan submit
 */

// Load .env jika ada
try {
  const fs = require("fs");
  const envPath = require("path").join(__dirname, ".env");
  if (fs.existsSync(envPath)) {
    fs.readFileSync(envPath, "utf-8").split("\n").forEach((line) => {
      const [key, ...rest] = line.split("=");
      if (key && !key.startsWith("#") && rest.length > 0) {
        process.env[key.trim()] = rest.join("=").trim();
      }
    });
  }
} catch { /* ignore */ }

// Parse CLI args
const args = process.argv.slice(2);
const getArg = (name) => {
  const idx = args.indexOf(name);
  return idx !== -1 ? args[idx + 1] : null;
};
const hasFlag = (name) => args.includes(name);

const opts = {
  minScore:   Number(getArg("--min-score")) || 60,
  limit:      Number(getArg("--limit")) || 10,
  autoSubmit: !hasFlag("--safe"),
  headless:   hasFlag("--headless"),
  dryRun:     hasFlag("--dry-run"),
};

// Validasi env vars
if (!process.env.GEMINI_API_KEY) {
  console.error("❌ GEMINI_API_KEY tidak ditemukan. Set di .env atau environment.");
  process.exit(1);
}

if (!process.env.TURSO_DATABASE_URL || !process.env.TURSO_AUTH_TOKEN) {
  console.error("❌ TURSO_DATABASE_URL dan TURSO_AUTH_TOKEN diperlukan. Set di .env atau environment.");
  process.exit(1);
}

// Run
const { run, getCandidates } = require("./lib/auto-apply/agent");

(async () => {
  try {
    if (opts.dryRun) {
      // Dry run: hanya tampilkan kandidat
      console.log("\n🔍 DRY RUN — menampilkan kandidat tanpa apply:\n");
      const candidates = await getCandidates(opts.minScore, opts.limit);
      if (candidates.length === 0) {
        console.log("  Tidak ada job eligible.");
      } else {
        candidates.forEach((job, i) => {
          console.log(`  ${i + 1}. [Score ${job.match_score}%] ${job.title}`);
          console.log(`     🏢 ${job.company || "?"} | 📍 ${job.location || "?"}`);
          console.log(`     🔗 ${job.url}\n`);
        });
      }
      console.log(`  Total: ${candidates.length} jobs\n`);
      process.exit(0);
    }

    const results = await run(opts);
    process.exit(results.failed > 0 && results.applied === 0 ? 1 : 0);
  } catch (err) {
    console.error("💥 Fatal error:", err);
    process.exit(1);
  }
})();
