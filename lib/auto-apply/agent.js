/**
 * lib/auto-apply/agent.js — Orchestrator utama auto-apply.
 *
 * Flow:
 * 1. Fetch pending jobs dari Turso DB (score ≥ minScore, status "pending")
 * 2. Untuk setiap job:
 *    a. Buka halaman job → cari tombol Apply
 *    b. Navigasi ke form → Gemini analisis HTML
 *    c. Isi form → screenshot → submit
 *    d. Update status di DB
 * 3. Log hasil ke file
 */

const browser = require("./browser");
const { findApplyButton, analyzeForm, detectPageState } = require("./ai-navigator");
const db = require("../db");
const fs = require("fs");
const path = require("path");

const LOG_DIR = path.join(__dirname, "../../logs/auto-apply");

/**
 * Ambil kandidat auto-apply dari DB.
 */
async function getCandidates(minScore = 60, limit = 10) {
  await db.migrate();
  return db.run(`
    SELECT * FROM jobs
    WHERE match_score >= ?
      AND status = 'pending'
      AND url IS NOT NULL
    ORDER BY match_score DESC
    LIMIT ?
  `, [minScore, limit]);
}

/**
 * Update status job setelah apply.
 */
async function markApplied(url, method, notes) {
  await db.exec(`
    UPDATE jobs
    SET status = 'applied',
        status_updated_at = datetime('now')
    WHERE url = ?
  `, [url]);
}

/**
 * Update status job yang gagal apply.
 */
async function markFailed(url, reason) {
  await db.exec(`
    UPDATE jobs
    SET status_updated_at = datetime('now')
    WHERE url = ?
  `, [url]);
}

/**
 * Proses satu job: buka → cari apply → isi form → submit.
 * @returns {object} { success, reason }
 */
async function processJob(job) {
  const log = (msg) => console.log(`  [${job.title?.slice(0, 40)}] ${msg}`);

  // Step 1: Navigasi ke halaman job
  log("📄 Membuka halaman job...");
  const navOk = await browser.navigateTo(job.url);
  if (!navOk) return { success: false, reason: "Gagal membuka halaman job" };

  // Step 2: Baca HTML dan cari tombol Apply
  log("🔍 Mencari tombol Apply...");
  let html = await browser.getCleanHTML();
  const applyBtn = await findApplyButton(html);

  if (!applyBtn.found) {
    log("⚠️  Tombol Apply tidak ditemukan");
    return { success: false, reason: "Tombol Apply tidak ditemukan" };
  }

  log(`🎯 Tombol Apply ditemukan: "${applyBtn.text}" (confidence: ${applyBtn.confidence}%)`);

  // Jika link eksternal, navigasi ke URL tersebut
  if (applyBtn.isExternalLink && applyBtn.href) {
    const fullUrl = applyBtn.href.startsWith("http")
      ? applyBtn.href
      : new URL(applyBtn.href, job.url).href;
    log(`🔗 Navigasi ke halaman apply eksternal: ${fullUrl}`);
    const extOk = await browser.navigateTo(fullUrl);
    if (!extOk) return { success: false, reason: "Gagal membuka halaman apply eksternal" };
  } else {
    // Klik tombol Apply
    const clicked = await browser.clickElement(applyBtn.selector);
    if (!clicked) {
      log("⚠️  Gagal klik tombol Apply, coba navigasi manual...");
      if (applyBtn.href) {
        const fullUrl = applyBtn.href.startsWith("http")
          ? applyBtn.href
          : new URL(applyBtn.href, browser.getCurrentUrl()).href;
        await browser.navigateTo(fullUrl);
      } else {
        return { success: false, reason: "Gagal klik tombol Apply" };
      }
    }
  }

  // Tunggu transisi halaman / modal ter-load sepenuhnya
  log("⏳ Menunggu halaman/modal form termuat...");
  await new Promise((r) => setTimeout(r, 4000));

  // Step 3: Loop form filling (support multi-page)
  let maxSteps = 5; // Max 5 halaman form
  let stepCount = 0;

  while (stepCount < maxSteps) {
    stepCount++;
    log(`📝 Menganalisis form (step ${stepCount})...`);

    html = await browser.getCleanHTML();
    const pageUrl = browser.getCurrentUrl();

    // Deteksi state halaman
    const state = await detectPageState(html);

    if (state.state === "confirmation") {
      log("🎉 Halaman konfirmasi terdeteksi — apply berhasil!");
      await browser.takeScreenshot(`${job.title}_confirmation`);
      return { success: true, reason: "Application submitted successfully" };
    }

    if (state.state === "captcha") {
      log("🤖 CAPTCHA terdeteksi — skip job ini");
      await browser.takeScreenshot(`${job.title}_captcha`);
      return { success: false, reason: "CAPTCHA detected" };
    }

    if (state.state === "login_required") {
      log("🔐 Login required — skip job ini");
      return { success: false, reason: "Login required" };
    }

    if (state.state === "error") {
      log("❌ Halaman error terdeteksi");
      await browser.takeScreenshot(`${job.title}_error`);
      return { success: false, reason: `Page error: ${state.message}` };
    }

    // Analisis form dengan Gemini
    const analysis = await analyzeForm(html, pageUrl);

    if (analysis.hasCaptcha) {
      log("🤖 CAPTCHA di form — skip");
      await browser.takeScreenshot(`${job.title}_captcha_form`);
      return { success: false, reason: "CAPTCHA in form" };
    }

    if (analysis.confidence < 30) {
      log(`⚠️  Confidence terlalu rendah (${analysis.confidence}%) — skip`);
      return { success: false, reason: `Low confidence: ${analysis.confidence}%` };
    }

    log(`🧠 Gemini: ${analysis.actions?.length || 0} aksi, confidence ${analysis.confidence}%`);
    if (analysis.notes) log(`   📋 ${analysis.notes}`);

    // Filter aksi: pisahkan submit click dari field fill
    const fieldActions = (analysis.actions || []).filter((a) => a.type !== "click");
    const submitAction = (analysis.actions || []).find((a) => a.type === "click");

    // Eksekusi field actions
    if (fieldActions.length > 0) {
      log(`✏️  Mengisi ${fieldActions.length} fields...`);
      const result = await browser.executeActions(fieldActions);
      log(`   Hasil: ${result.success} sukses, ${result.failed} gagal`);

      if (result.failed > 0) {
        log(`   ⚠️  Errors: ${result.errors.join(", ")}`);
      }
    }

    // Screenshot sebelum submit
    const screenshotPath = await browser.takeScreenshot(`${job.title}_step${stepCount}`);
    log(`📸 Screenshot: ${path.basename(screenshotPath)}`);

    // Submit/Next
    if (submitAction) {
      log(`🖱️  Klik: ${submitAction.label || submitAction.selector}`);
      await browser.clickSubmit(submitAction.selector);

      // Tunggu halaman berubah
      await new Promise((r) => setTimeout(r, 3000));
    }

    // Cek apakah ada step berikutnya
    if (!analysis.hasNextStep && submitAction) {
      // Cek halaman setelah submit
      const postHtml = await browser.getCleanHTML();
      const postState = await detectPageState(postHtml);

      if (postState.state === "confirmation") {
        log("🎉 Apply berhasil — konfirmasi terdeteksi!");
        await browser.takeScreenshot(`${job.title}_success`);
        return { success: true, reason: "Application submitted" };
      } else if (postState.state === "form" && postState.hasMoreFields) {
        log("📄 Masih ada form lanjutan...");
        continue;
      } else {
        // Assume success jika halaman berubah setelah submit
        log("✅ Submit selesai (state: " + postState.state + ")");
        await browser.takeScreenshot(`${job.title}_done`);
        return { success: true, reason: `Submitted (post-state: ${postState.state})` };
      }
    }
  }

  return { success: false, reason: `Max steps (${maxSteps}) reached` };
}

/**
 * Main runner: proses semua kandidat.
 */
async function run(opts = {}) {
  const { minScore = 60, limit = 10, autoSubmit = true, headless = false } = opts;

  console.log("\n╔══════════════════════════════════════════════════╗");
  console.log("║   🤖 Cocok Auto-Apply Agent                     ║");
  console.log("║   Playwright + Gemini AI                         ║");
  console.log("╚══════════════════════════════════════════════════╝\n");
  console.log(`  ⚙️  Min Score: ${minScore} | Limit: ${limit} | Auto Submit: ${autoSubmit}`);
  console.log(`  ⚙️  Headless: ${headless}\n`);

  // Ensure log directory exists
  fs.mkdirSync(LOG_DIR, { recursive: true });

  // Log file
  const logFile = path.join(LOG_DIR, `${new Date().toISOString().slice(0, 10)}.log`);
  const logToFile = (msg) => {
    fs.appendFileSync(logFile, `[${new Date().toISOString()}] ${msg}\n`);
  };

  // Step 1: Ambil kandidat
  console.log("📊 Mengambil kandidat dari database...");
  const candidates = await getCandidates(minScore, limit);
  console.log(`   Ditemukan ${candidates.length} jobs eligible\n`);

  if (candidates.length === 0) {
    console.log("   Tidak ada job yang perlu di-apply. Selesai!\n");
    return { applied: 0, failed: 0, skipped: 0 };
  }

  // Step 2: Launch browser
  await browser.launch({ headless, slowMo: autoSubmit ? 200 : 500 });

  const results = { applied: 0, failed: 0, skipped: 0, details: [] };

  // Step 3: Proses setiap job
  for (let i = 0; i < candidates.length; i++) {
    const job = candidates[i];
    const num = `[${i + 1}/${candidates.length}]`;

    console.log(`\n${"═".repeat(60)}`);
    console.log(`${num} ${job.title}`);
    console.log(`    🏢 ${job.company || "?"} | 📍 ${job.location || "?"} | 🎯 Score: ${job.match_score}%`);
    console.log(`    🔗 ${job.url}`);
    console.log(`${"─".repeat(60)}`);

    try {
      const result = await processJob(job);

      if (result.success) {
        results.applied++;
        await markApplied(job.url, "auto", result.reason);
        console.log(`  ✅ APPLIED — ${result.reason}`);
        logToFile(`SUCCESS | ${job.title} | ${job.company} | ${result.reason}`);
      } else {
        results.failed++;
        await markFailed(job.url, result.reason);
        console.log(`  ❌ FAILED — ${result.reason}`);
        logToFile(`FAILED | ${job.title} | ${job.company} | ${result.reason}`);
      }

      results.details.push({
        title: job.title,
        company: job.company,
        url: job.url,
        ...result,
      });

    } catch (err) {
      results.failed++;
      console.log(`  💥 ERROR — ${err.message}`);
      logToFile(`ERROR | ${job.title} | ${job.company} | ${err.message}`);
      results.details.push({
        title: job.title,
        company: job.company,
        url: job.url,
        success: false,
        reason: err.message,
      });
    }

    // Delay antar job (30-60 detik random)
    if (i < candidates.length - 1) {
      const delay = 30000 + Math.random() * 30000;
      console.log(`\n  ⏳ Delay ${(delay / 1000).toFixed(0)} detik sebelum job berikutnya...`);
      await new Promise((r) => setTimeout(r, delay));
    }
  }

  // Step 4: Tutup browser
  await browser.close();

  // Step 5: Summary
  console.log(`\n${"═".repeat(60)}`);
  console.log("📊 HASIL AUTO-APPLY:");
  console.log(`   ✅ Applied: ${results.applied}`);
  console.log(`   ❌ Failed:  ${results.failed}`);
  console.log(`   📝 Log:     ${logFile}`);
  console.log(`   📸 Screenshots: ${path.join(LOG_DIR, "screenshots/")}`);
  console.log(`${"═".repeat(60)}\n`);

  logToFile(`\nSUMMARY: applied=${results.applied} failed=${results.failed}`);

  return results;
}

module.exports = { run, getCandidates, processJob };
