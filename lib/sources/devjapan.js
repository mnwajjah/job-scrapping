/**
 * lib/sources/devjapan.js — Scraper untuk Japan Dev (devjapan.com / japan-dev.com).
 * Job board developer di Jepang dengan banyak remote/English-friendly roles.
 */

const cheerio = require("cheerio");

const BASE_URL = "https://japan-dev.com";

async function searchJobs({ keyword, location, maxResults = 20 }) {
  // japan-dev.com has a public jobs listing
  const params = new URLSearchParams({ search: keyword || "" });
  const url = `${BASE_URL}/jobs?${params}`;

  const res = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; CocokBot/1.0)",
      Accept: "text/html",
    },
  });

  if (!res.ok) {
    const err = new Error(`Japan Dev: gagal load halaman (status ${res.status})`);
    err.code = "SCRAPE_HTTP";
    throw err;
  }

  const html = await res.text();
  const $ = cheerio.load(html);
  const jobs = [];

  // Japan-dev job card selectors
  $("div[class*='job'], article, li[class*='listing']").each((_, el) => {
    const $el = $(el);
    const titleEl = $el.find("h2, h3, a[href*='/jobs/']").first();
    const title = titleEl.text().trim();
    const href =
      $el.find("a[href*='/jobs/']").first().attr("href") ||
      $el.find("a").first().attr("href") ||
      null;

    if (!title || !href || title.length < 3) return;

    const company = $el.find("[class*='company'], [class*='employer']").first().text().trim() || null;
    const loc = $el.find("[class*='location'], [class*='remote']").first().text().trim() || "Japan";
    const salary = $el.find("[class*='salary'], [class*='pay'], [class*='compensation']").first().text().trim() || null;
    const tags = $el.find("[class*='tag'], [class*='skill']").map((_, t) => $(t).text().trim()).get().join(", ");

    jobs.push({
      title,
      company,
      location: loc,
      salary,
      description: (tags ? `Tech: ${tags}. ` : "") + $el.text().replace(/\s+/g, " ").slice(0, 350),
      url: href.startsWith("http") ? href : `${BASE_URL}${href}`,
    });
  });

  // Also try JSON-LD structured data
  if (jobs.length === 0) {
    $('script[type="application/ld+json"]').each((_, el) => {
      try {
        const data = JSON.parse($(el).html());
        const items = Array.isArray(data) ? data : [data];
        items.forEach((item) => {
          if (item["@type"] !== "JobPosting") return;
          jobs.push({
            title: item.title || item.name,
            company: item.hiringOrganization?.name || null,
            location: item.jobLocation?.address?.addressLocality || "Japan",
            salary: item.baseSalary?.value?.value || null,
            description: (item.description || "").replace(/<[^>]+>/g, " ").slice(0, 400),
            url: item.url || null,
          });
        });
      } catch { /* skip */ }
    });
  }

  const deduped = Array.from(new Map(jobs.filter((j) => j.url).map((j) => [j.url, j])).values());
  if (deduped.length === 0) {
    const err = new Error("Japan Dev: tidak ada lowongan ditemukan.");
    err.code = "SCRAPE_EMPTY";
    throw err;
  }
  return deduped.slice(0, maxResults);
}

module.exports = { id: "devjapan", label: "Japan Dev", searchJobs };
