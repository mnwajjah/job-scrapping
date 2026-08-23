/**
 * lib/sources/indeed.js — Scraper untuk Indeed Indonesia.
 * Pakai fetch + Cheerio ke halaman listing publik.
 */

const cheerio = require("cheerio");

const BASE_URL = "https://id.indeed.com";

async function searchJobs({ keyword, location, maxResults = 20 }) {
  const params = new URLSearchParams({ q: keyword || "", l: location || "" });
  const url = `${BASE_URL}/jobs?${params}`;

  const res = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      "Accept-Language": "id-ID,id;q=0.9,en;q=0.8",
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    },
  });

  if (!res.ok) {
    const err = new Error(`Indeed: gagal load halaman (status ${res.status})`);
    err.code = "SCRAPE_HTTP";
    throw err;
  }

  const html = await res.text();
  const $ = cheerio.load(html);
  const jobs = [];

  // Indeed: job cards dengan data-testid atau class mosaic-job-card
  $("div[class*='job_seen_beacon'], div[class*='resultContent'], div[class*='tapItem']").each((_, el) => {
    const $el = $(el);

    const titleEl = $el.find("h2[class*='jobTitle'] a, a[data-testid='job-title'], span[title]").first();
    const title = titleEl.text().trim() || $el.find("h2").first().text().trim();
    const href = titleEl.attr("href") || $el.find("a[href*='/rc/clk']").first().attr("href") || null;
    const company = $el.find("span[class*='company'], div[class*='company_location'] span").first().text().trim() || null;
    const loc = $el.find("[class*='location'], div[class*='company_location']").last().text().trim() || null;
    const salary = $el.find("[class*='salary'], [class*='estimated-salary']").first().text().trim() || null;
    const desc = $el.find("[class*='job-snippet'], p").first().text().trim() || null;

    if (!title || !href) return;
    jobs.push({
      title,
      company,
      location: loc,
      salary,
      description: desc,
      url: href.startsWith("http") ? href.split("?")[0] : `${BASE_URL}${href.split("?")[0]}`,
    });
  });

  const deduped = Array.from(new Map(jobs.map((j) => [j.url, j])).values());
  if (deduped.length === 0) {
    const err = new Error("Indeed: tidak ada lowongan ditemukan atau diblokir bot detection.");
    err.code = "SCRAPE_EMPTY";
    throw err;
  }
  return deduped.slice(0, maxResults);
}

module.exports = { id: "indeed", label: "Indeed", searchJobs };
