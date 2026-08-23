/**
 * lib/sources/linkedin.js — Scraper untuk LinkedIn Jobs.
 * Pakai LinkedIn Jobs public search (tidak butuh login untuk listing dasar).
 * Cheerio parse dari public job listing page.
 */

const cheerio = require("cheerio");

const BASE_URL = "https://www.linkedin.com/jobs/search";

async function searchJobs({ keyword, location, maxResults = 20 }) {
  const params = new URLSearchParams({
    keywords: keyword || "",
    location: location || "Indonesia",
    f_TPR: "r86400", // last 24 hours filter
    sortBy: "R",
  });

  const url = `${BASE_URL}?${params}`;

  const res = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      Accept: "text/html,application/xhtml+xml",
      "Accept-Language": "en-US,en;q=0.9",
    },
  });

  if (!res.ok) {
    const err = new Error(`LinkedIn: gagal load halaman (status ${res.status})`);
    err.code = "SCRAPE_HTTP";
    throw err;
  }

  const html = await res.text();
  const $ = cheerio.load(html);
  const jobs = [];

  // LinkedIn public job cards
  $("li[class*='jobs-search__result-item'], .base-card, .job-search-card").each((_, el) => {
    const $el = $(el);

    const titleEl = $el.find("h3.base-search-card__title, h3[class*='title'], a[class*='job-card-list__title']").first();
    const title = titleEl.text().trim();

    const href =
      $el.find("a.base-card__full-link, a[class*='job-card'], a[href*='/jobs/view/']").first().attr("href") || null;

    const company = $el.find("h4.base-search-card__subtitle, a[class*='company']").first().text().trim() || null;
    const loc = $el.find("span.job-search-card__location, [class*='location']").first().text().trim() || null;

    if (!title || !href) return;

    jobs.push({
      title,
      company,
      location: loc,
      salary: null,
      description: $el.text().replace(/\s+/g, " ").slice(0, 300),
      url: href.startsWith("http") ? href.split("?")[0] : `https://www.linkedin.com${href.split("?")[0]}`,
    });
  });

  // Try alternate selectors if nothing found
  if (jobs.length === 0) {
    $("div.job-search-card, div[data-entity-urn]").each((_, el) => {
      const $el = $(el);
      const title = $el.find("h3, h2").first().text().trim();
      const href = $el.find("a[href*='/jobs/']").first().attr("href");
      const company = $el.find("h4, [class*='company']").first().text().trim() || null;
      const loc = $el.find("[class*='location']").first().text().trim() || null;

      if (!title || !href) return;
      jobs.push({
        title, company, location: loc, salary: null,
        description: $el.text().replace(/\s+/g, " ").slice(0, 300),
        url: href.startsWith("http") ? href.split("?")[0] : `https://www.linkedin.com${href.split("?")[0]}`,
      });
    });
  }

  const deduped = Array.from(new Map(jobs.map((j) => [j.url, j])).values());
  if (deduped.length === 0) {
    const err = new Error("LinkedIn: tidak ada lowongan ditemukan — mungkin diblokir bot detection.");
    err.code = "SCRAPE_EMPTY";
    throw err;
  }
  return deduped.slice(0, maxResults);
}

module.exports = { id: "linkedin", label: "LinkedIn", searchJobs };
