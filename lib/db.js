/**
 * lib/db.js — Turso HTTP client (no SDK needed, pure fetch).
 * Env: TURSO_DATABASE_URL, TURSO_AUTH_TOKEN
 *
 * Turso REST API format:
 * POST {url}/v2/pipeline
 * Body: { requests: [{ type: "execute", stmt: { sql, args } }, { type: "close" }] }
 */

let DB_URL = process.env.TURSO_DATABASE_URL;
if (DB_URL && DB_URL.startsWith("libsql://")) {
  DB_URL = DB_URL.replace("libsql://", "https://");
}
const DB_AUTH = process.env.TURSO_AUTH_TOKEN;

/**
 * Jalankan satu atau lebih SQL statement.
 * @param {Array<{sql: string, args?: any[]}>} stmts
 * @returns {Promise<Array>} rows dari tiap statement
 */
async function query(stmts) {
  if (!DB_URL || !DB_AUTH) {
    throw new Error("TURSO_DATABASE_URL atau TURSO_AUTH_TOKEN belum diset.");
  }

  const requests = [
    ...stmts.map((s) => ({
      type: "execute",
      stmt: {
        sql: s.sql,
        args: (s.args || []).map(toTursoArg),
      },
    })),
    { type: "close" },
  ];

  const res = await fetch(`${DB_URL}/v2/pipeline`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${DB_AUTH}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ requests }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Turso HTTP ${res.status}: ${text.slice(0, 200)}`);
  }

  const data = await res.json();

  // Check for errors in individual statements
  const results = data.results || [];
  results.forEach((r, i) => {
    if (r.type === "error") {
      throw new Error(`Turso query[${i}] error: ${r.error?.message}`);
    }
  });

  // Parse rows dari setiap result
  return results
    .filter((r) => r.type === "ok" && r.response && (r.response.type === "resultSet" || r.response.type === "execute"))
    .map((r) => parseRows(r.response.result));
}

/** Run satu SQL statement, return rows. */
async function run(sql, args = []) {
  const [rows] = await query([{ sql, args }]);
  return rows || [];
}

/** Run satu SQL, return first row atau null. */
async function first(sql, args = []) {
  const rows = await run(sql, args);
  return rows[0] || null;
}

/** Execute tanpa return (INSERT/UPDATE/DELETE). */
async function exec(sql, args = []) {
  await query([{ sql, args }]);
}

/** Batch execute multiple statements in one pipeline. */
async function batch(stmts) {
  return query(stmts);
}

// ── Helpers ────────────────────────────────────────────────────────────────

function toTursoArg(val) {
  if (val === null || val === undefined) return { type: "null" };
  if (typeof val === "number" && Number.isInteger(val)) return { type: "integer", value: String(val) };
  if (typeof val === "number") return { type: "float", value: String(val) };
  if (typeof val === "boolean") return { type: "integer", value: val ? "1" : "0" };
  return { type: "text", value: String(val) };
}

function parseRows(result) {
  if (!result || !result.rows) return [];
  const cols = result.cols.map((c) => c.name);
  return result.rows.map((row) => {
    const obj = {};
    cols.forEach((col, i) => {
      const cell = row[i];
      obj[col] = cell?.type === "null" ? null : cell?.value ?? null;
    });
    return obj;
  });
}

/** Buat tabel kalau belum ada. Panggil sekali saat cold start. */
async function migrate() {
  await exec(`
    CREATE TABLE IF NOT EXISTS jobs (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      url             TEXT UNIQUE NOT NULL,
      title           TEXT,
      company         TEXT,
      location        TEXT,
      salary          TEXT,
      description     TEXT,
      source          TEXT,
      source_label    TEXT,
      match_score     INTEGER DEFAULT 0,
      chance_label    TEXT,
      recommendation  TEXT,
      reasoning       TEXT,
      tech_matched    TEXT DEFAULT '[]',
      tech_learn      TEXT DEFAULT '[]',
      tech_missing    TEXT DEFAULT '[]',
      strengths       TEXT DEFAULT '[]',
      gaps            TEXT DEFAULT '[]',
      notified        INTEGER DEFAULT 0,
      status          TEXT DEFAULT 'pending',
      scraped_at      TEXT DEFAULT (datetime('now')),
      notified_at     TEXT,
      reminder_sent_at TEXT,
      status_updated_at TEXT
    )
  `);

  // Hapus jobs lebih dari 30 hari (cleanup otomatis)
  await exec(`DELETE FROM jobs WHERE scraped_at < datetime('now', '-30 days')`);
}

module.exports = { query, run, first, exec, batch, migrate };
