/**
 * lib/sources/glints.js — Scraper untuk Glints.
 * Glints punya public GraphQL API — jauh lebih reliable dari HTML scraping.
 * Fallback ke HTML scraping kalau API gagal.
 */

const cheerio = require("cheerio");

const GRAPHQL_URL = "https://glints.com/api/graphql";
const LIST_URL    = "https://glints.com/id/opportunities/jobs/explore";

// Browser-like headers untuk menghindari 403
const BROWSER_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
  "Accept": "application/json, text/html, */*",
  "Accept-Language": "en-US,en;q=0.9,id;q=0.8",
  "Accept-Encoding": "gzip, deflate, br",
  "Origin": "https://glints.com",
  "Referer": "https://glints.com/id/opportunities/jobs/explore",
};

async function searchJobs({ keyword, location, maxResults = 20 }) {
  // Coba GraphQL API dulu
  try {
    return await searchViaApi({ keyword, location, maxResults });
  } catch (apiErr) {
    console.warn("[glints] API gagal, fallback ke HTML:", apiErr.message);
  }

  // Fallback: HTML scraping dengan URL search
  return searchViaHtml({ keyword, location, maxResults });
}

async function searchViaApi({ keyword, location, maxResults }) {
  const query = `
    query SearchJobs($keyword: String, $locationName: String, $limit: Int) {
      searchJobs(keyword: $keyword, locationName: $locationName, limit: $limit) {
        jobs {
          id title status
          salary { salaryTokens { salaryAmount currency } }
          company { name }
          citySubDivisionName countryCode
          highlightedText
        }
      }
    }
  `;

  const res = await fetch(GRAPHQL_URL, {
    method: "POST",
    headers: { ...BROWSER_HEADERS, "Content-Type": "application/json" },
    body: JSON.stringify({
      query,
      variables: { keyword: keyword || "developer", locationName: location || null, limit: maxResults },
    }),
  });

  if (!res.ok) throw new Error(`Glints API: status ${res.status}`);

  const json = await res.json();
  const jobs = json?.data?.searchJobs?.jobs || [];

  if (jobs.length === 0) throw new Error("Glints API: tidak ada hasil");

  return jobs.slice(0, maxResults).map((j) => ({
    title: j.title,
    company: j.company?.name || null,
    location: [j.citySubDivisionName, j.countryCode].filter(Boolean).join(", ") || null,
    salary: j.salary?.salaryTokens?.[0]
      ? `${j.salary.salaryTokens[0].salaryAmount} ${j.salary.salaryTokens[0].currency}`
      : null,
    description: j.highlightedText || null,
    url: `https://glints.com/id/opportunities/jobs/${j.id}`,
  }));
}

async function searchViaHtml({ keyword, location, maxResults }) {
  const params = new URLSearchParams();
  if (keyword) params.set("keyword", keyword);
  if (location) params.set("locationName", location);

  const url = `${LIST_URL}?${params}`;
  const res = await fetch(url, { headers: BROWSER_HEADERS });

  if (!res.ok) {
    const err = new Error(`Glints: gagal load halaman (status ${res.status}).`);
    err.code = "SCRAPE_HTTP";
    throw err;
  }

  const html = await res.text();
  const $ = cheerio.load(html);
  const jobs = [];

  $('a[href*="/opportunities/jobs/"]').each((_, el) => {
    const $a = $(el);
    const title = $a.text().trim();
    const href = $a.attr("href");
    if (!title || !href || title.length < 4) return;

    const $card = $a.parents().filter((__, p) => $(p).find('a[href*="/companies/"]').length > 0).first();
    const company = $card.find('a[href*="/companies/"]').first().text().trim() || null;
    const loc = $card.find('a[href*="/job-location/"]').first().text().trim() || null;

    jobs.push({
      title,
      company,
      location: loc,
      salary: null,
      description: $card.text().replace(/\s+/g, " ").slice(0, 300),
      url: href.startsWith("http") ? href.split("?")[0] : `https://glints.com${href.split("?")[0]}`,
    });
  });

  const kw = (keyword || "").trim().toLowerCase();
  let filtered = kw
    ? jobs.filter((j) => j.title.toLowerCase().includes(kw) || (j.description || "").toLowerCase().includes(kw))
    : jobs;

  const deduped = Array.from(new Map(filtered.map((j) => [j.url, j])).values());
  if (deduped.length === 0) {
    const err = new Error("Glints: tidak ada lowongan cocok atau struktur berubah.");
    err.code = "SCRAPE_EMPTY";
    throw err;
  }
  return deduped.slice(0, maxResults);
}

module.exports = { id: "glints", label: "Glints", searchJobs };
