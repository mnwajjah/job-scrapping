/**
 * lib/auto-apply/browser.js — Playwright browser controller untuk auto-apply.
 *
 * Mengelola browser Chromium: navigasi, baca HTML, eksekusi aksi,
 * screenshot, dan file upload.
 */

const { chromium } = require("playwright");
const path = require("path");
const fs = require("fs");

const CV_PDF_PATH = "/Users/mwajjah/Documents/Wajjah/CV_Muhammad_Nur_Wajjah.pdf";
const CV_DOCX_PATH = "/Users/mwajjah/Documents/Wajjah/Muhammad_Nur_Wajjah_CV.docx";

const SCREENSHOT_DIR = path.join(__dirname, "../../logs/auto-apply/screenshots");

let browser = null;
let context = null;
let page = null;

async function injectStealth(p) {
  if (!p) return;
  try {
    await p.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', {
        get: () => undefined,
      });
    });
  } catch (err) {
    console.warn("  ⚠️  Gagal inject stealth script:", err.message);
  }
}

/**
 * Launch browser (headed mode agar bisa dilihat prosesnya).
 */
async function launch(opts = {}) {
  // Pastikan screenshot dir ada
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

  // STRATEGI 1: Coba connect ke Chrome debugging port 9222 yang sedang berjalan
  try {
    console.log("  🔍 Mencoba menghubungkan ke Google Chrome aktif (port 9222)...");
    browser = await chromium.connectOverCDP("http://localhost:9222", { timeout: 3000 });
    
    // Ambil context dan page pertama dari browser aktif
    const contexts = browser.contexts();
    if (contexts.length > 0) {
      context = contexts[0];
      const pages = context.pages();
      page = pages.length > 0 ? pages[0] : await context.newPage();
    } else {
      context = await browser.newContext();
      page = await context.newPage();
    }
    
    await injectStealth(page);
    console.log("  ✅ Berhasil terhubung ke Google Chrome aktif kamu!");
    return page;
  } catch (err) {
    console.log("  ℹ️  Chrome aktif (port 9222) tidak terdeteksi. Mencoba membuka Chrome profile baru...");
  }

  // STRATEGI 2: Buka instance Chrome baru menggunakan profile user Mac lokal
  const chromeDataDir = "/Users/mwajjah/Library/Application Support/Google/Chrome";
  
  try {
    context = await chromium.launchPersistentContext(chromeDataDir, {
      channel: "chrome",
      headless: opts.headless ?? false,
      slowMo: opts.slowMo ?? 300,
      viewport: { width: 1280, height: 900 },
      ignoreDefaultArgs: ["--enable-automation"],
      args: [
        "--profile-directory=Default",
        "--window-size=1280,900",
        "--disable-blink-features=AutomationControlled"
      ],
    });
    
    browser = null; // launchPersistentContext mengembalikan context secara langsung
    const pages = context.pages();
    page = pages.length > 0 ? pages[0] : await context.newPage();
    
    await injectStealth(page);
    console.log("  ✅ Berhasil membuka Google Chrome dengan profil Default!");
    return page;
  } catch (err) {
    console.error(`  ❌ Gagal membuka Chrome profile: ${err.message}`);
    console.log("  ℹ️  Membuat browser Chromium kosong (non-login) sebagai fallback...");
    
    // Fallback: browser kosong biasa
    browser = await chromium.launch({
      headless: opts.headless ?? false,
      slowMo: opts.slowMo ?? 300,
      ignoreDefaultArgs: ["--enable-automation"],
      args: [
        "--window-size=1280,900",
        "--disable-blink-features=AutomationControlled"
      ],
    });
    context = await browser.newContext({
      viewport: { width: 1280, height: 900 },
      userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      locale: "en-US",
    });
    page = await context.newPage();
    
    await injectStealth(page);
    console.log("  🌐 Browser Chromium kosong launched (headed mode)");
    return page;
  }
  return page;
}

/**
 * Navigasi ke URL dan tunggu halaman stabil.
 */
async function navigateTo(url) {
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
    // Tunggu sedikit untuk JS rendering
    await page.waitForTimeout(2000);
    return true;
  } catch (err) {
    console.error(`  ❌ Gagal navigasi ke ${url}: ${err.message}`);
    return false;
  }
}

/**
 * Ambil HTML halaman saat ini (disanitasi untuk Gemini).
 * Hapus script, style, svg, dll untuk menghemat token.
 */
async function getCleanHTML() {
  return page.evaluate(() => {
    // Clone body agar tidak modifikasi halaman asli
    const clone = document.body.cloneNode(true);

    // Hapus elemen yang tidak relevan
    const removeSelectors = [
      "script", "style", "svg", "img", "video", "audio", "iframe",
      "noscript", "link[rel=stylesheet]", "meta", "header nav",
      "footer", "[role=banner]", "[role=navigation]",
      "[class*=cookie]", "[class*=popup]", "[class*=modal]",
      "[class*=advertisement]", "[class*=sidebar]",
    ];
    removeSelectors.forEach((sel) => {
      clone.querySelectorAll(sel).forEach((el) => el.remove());
    });

    // Hapus atribut yang tidak perlu dari semua elemen
    clone.querySelectorAll("*").forEach((el) => {
      const keep = ["id", "name", "type", "value", "placeholder", "class",
                     "href", "action", "method", "for", "required", "checked",
                     "selected", "multiple", "accept", "role", "aria-label",
                     "data-testid"];
      Array.from(el.attributes).forEach((attr) => {
        if (!keep.includes(attr.name)) el.removeAttribute(attr.name);
      });
    });

    return clone.innerHTML.replace(/\s+/g, " ").trim();
  });
}

/**
 * Cari dan klik elemen berdasarkan CSS selector.
 * Gunakan berbagai strategi fallback.
 */
async function clickElement(selector) {
  try {
    // 1. Coba klik element yang terlihat (visible)
    const el = page.locator(selector).filter({ visible: true }).first();
    await el.waitFor({ state: "visible", timeout: 4000 });
    await el.click({ timeout: 4000 });
    await page.waitForTimeout(2000);
    return true;
  } catch (err) {
    console.warn(`    ⚠️  Standard click gagal untuk selector ${selector}: ${err.message}`);
    
    // 2. Fallback: coba trigger click event langsung via JS (bypass overlay/interception)
    try {
      const el = page.locator(selector).first();
      await el.dispatchEvent("click");
      await page.waitForTimeout(2000);
      console.log(`    ✅ Fallback dispatchEvent click berhasil untuk: ${selector}`);
      return true;
    } catch (err2) {
      console.warn(`    ⚠️  Fallback dispatchEvent gagal: ${err2.message}`);
    }

    // 3. Fallback: cari tombol berdasarkan teks umum
    try {
      const applyTexts = ["Apply", "Apply Now", "Lamar", "Lamar Sekarang", "Submit", "Next"];
      for (const text of applyTexts) {
        const btn = page.locator(`button:has-text("${text}")`).or(
          page.locator(`a:has-text("${text}")`)
        ).filter({ visible: true }).first();

        if (await btn.count() > 0) {
          try {
            await btn.click({ timeout: 3000 });
            await page.waitForTimeout(2000);
            return true;
          } catch {
            await btn.dispatchEvent("click");
            await page.waitForTimeout(2000);
            return true;
          }
        }
      }
    } catch { /* ignore */ }
    
    return false;
  }
}

/**
 * Eksekusi array aksi dari Gemini AI.
 * @param {Array} actions - [{type, selector, value, label}]
 * @returns {object} - {success: number, failed: number, errors: string[]}
 */
async function executeActions(actions) {
  const results = { success: 0, failed: 0, errors: [], skippedUpload: false };

  for (const action of actions) {
    const { type, selector, value, label } = action;

    try {
      switch (type) {
        case "fill": {
          const el = page.locator(selector).first();
          await el.waitFor({ state: "visible", timeout: 5000 });
          await el.clear();
          // Ketik karakter per karakter untuk form yang punya JS validation
          await el.type(value, { delay: 30 });
          results.success++;
          console.log(`    ✅ Fill: ${label || selector} = "${(value || "").slice(0, 40)}..."`);
          break;
        }

        case "select": {
          const el = page.locator(selector).first();
          await el.waitFor({ state: "visible", timeout: 5000 });
          try {
            await el.selectOption(value);
          } catch {
            // Fallback: coba by label text
            await el.selectOption({ label: value });
          }
          results.success++;
          console.log(`    ✅ Select: ${label || selector} = "${value}"`);
          break;
        }

        case "check": {
          const el = page.locator(selector).first();
          await el.waitFor({ state: "visible", timeout: 5000 });
          if (!(await el.isChecked())) {
            await el.check();
          }
          results.success++;
          console.log(`    ✅ Check: ${label || selector}`);
          break;
        }

        case "upload": {
          // Pilih file: prefer PDF, fallback ke DOCX
          let filePath = null;
          if (fs.existsSync(CV_PDF_PATH)) filePath = CV_PDF_PATH;
          else if (fs.existsSync(CV_DOCX_PATH)) filePath = CV_DOCX_PATH;

          if (!filePath) {
            console.log(`    ⚠️  Skip upload: CV file tidak ditemukan`);
            results.skippedUpload = true;
            break;
          }

          const el = page.locator(selector).first();
          await el.setInputFiles(filePath);
          results.success++;
          console.log(`    ✅ Upload: ${label || selector} = ${path.basename(filePath)}`);
          break;
        }

        case "click": {
          // Click di akhir (biasanya submit/next) — handled separately
          // Kita skip di sini, akan di-handle oleh caller
          console.log(`    ⏩ Click queued: ${label || selector}`);
          break;
        }

        default:
          console.log(`    ⚠️  Unknown action type: ${type}`);
      }

      // Delay kecil antar aksi
      await page.waitForTimeout(500);

    } catch (err) {
      results.failed++;
      results.errors.push(`${label || selector}: ${err.message}`);
      console.log(`    ❌ Failed: ${label || selector} — ${err.message}`);
    }
  }

  return results;
}

/**
 * Ambil screenshot halaman saat ini.
 * @returns {string} path ke file screenshot
 */
async function takeScreenshot(jobTitle) {
  const safeName = (jobTitle || "unknown")
    .replace(/[^a-zA-Z0-9_-]/g, "_")
    .slice(0, 50);
  const filename = `${new Date().toISOString().slice(0, 10)}_${safeName}.png`;
  const filepath = path.join(SCREENSHOT_DIR, filename);
  await page.screenshot({ path: filepath, fullPage: false });
  return filepath;
}

/**
 * Klik tombol submit/next terakhir.
 */
async function clickSubmit(selector) {
  return clickElement(selector);
}

/**
 * Ambil URL halaman saat ini.
 */
function getCurrentUrl() {
  return page.url();
}

/**
 * Tutup browser.
 */
async function close() {
  if (context) {
    try { await context.close(); } catch { /* ignore */ }
    context = null;
  }
  if (browser) {
    try { await browser.close(); } catch { /* ignore */ }
    browser = null;
  }
  page = null;
}

module.exports = {
  launch,
  navigateTo,
  getCleanHTML,
  clickElement,
  executeActions,
  takeScreenshot,
  clickSubmit,
  getCurrentUrl,
  close,
};
