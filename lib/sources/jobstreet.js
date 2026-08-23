/**
 * Scraper untuk id.jobstreet.com — versi serverless (Vercel).
 * Puppeteer + @sparticuz/chromium karena halaman client-side rendered.
 *
 * KETERBATASAN: timeout function serverless, IP data center Vercel lebih
 * gampang kena deteksi bot. Kalau gagal, pakai tab "Tempel Manual".
 */

const chromium = require("@sparticuz/chromium");
const puppeteer = require("puppeteer-core");

const BASE_URL = "https://id.jobstreet.com";

function buildSearchUrl({ keyword, location }) {
  const slug = encodeURIComponent(keyword.trim().toLowerCase().replace(/\s+/g, "-"));
  const url = new URL(`${BASE_URL}/id/${slug}-jobs`);
  if (location) url.searchParams.set("where", location);
  return url.toString();
}

async function getBrowser() {
  const executablePath = await chromium.executablePath();
  return puppeteer.launch({
    args: chromium.args,
    defaultViewport: chromium.defaultViewport,
    executablePath,
    headless: chromium.headless,
  });
}

async function searchJobs({ keyword, location, maxResults = 20 }) {
  const url = buildSearchUrl({ keyword, location });
  const browser = await getBrowser();

  try {
    const page = await browser.newPage();
    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
        "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
    );

    await page.goto(url, { waitUntil: "networkidle2", timeout: 9000 });
    await page.waitForSelector('article[data-testid="job-card"]', { timeout: 6000 }).catch(() => null);

    const jobs = await page.evaluate((limit) => {
      const cards = Array.from(document.querySelectorAll('article[data-testid="job-card"]'));
      return cards.slice(0, limit).map((card) => {
        const titleEl = card.querySelector('a[data-testid="job-card-title"]');
        const companyEl = card.querySelector('[data-testid="job-card-company"]');
        const locationEl = card.querySelector('[data-testid="job-card-location"]');
        const salaryEl = card.querySelector('[data-testid="job-card-salary"]');
        const teaserEl = card.querySelector('[data-testid="job-card-teaser"]');
        const href = titleEl ? titleEl.getAttribute("href") : null;

        return {
          title: titleEl ? titleEl.textContent.trim() : null,
          company: companyEl ? companyEl.textContent.trim() : null,
          location: locationEl ? locationEl.textContent.trim() : null,
          salary: salaryEl ? salaryEl.textContent.trim() : null,
          description: teaserEl ? teaserEl.textContent.trim() : "",
          url: href ? new URL(href, window.location.origin).toString() : null,
        };
      });
    }, maxResults);

    const validJobs = jobs.filter((j) => j.title && j.url);

    if (validJobs.length === 0) {
      const err = new Error("Tidak ada lowongan dari JobStreet — mungkin diblokir atau struktur halaman berubah.");
      err.code = "SCRAPE_EMPTY";
      throw err;
    }

    return validJobs;
  } finally {
    await browser.close();
  }
}

module.exports = { id: "jobstreet", label: "JobStreet", searchJobs };
