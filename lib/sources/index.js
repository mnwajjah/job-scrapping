/**
 * lib/sources/index.js — Daftar semua sumber lowongan.
 * Tambah sumber baru di sini: import dan daftarkan di SOURCES array.
 */

const glints     = require("./glints");
const jobstreet  = require("./jobstreet");
const hennge     = require("./hennge");
const mercari    = require("./mercari");
const kalibrr    = require("./kalibrr");
const techinasia = require("./techinasia");
const indeed     = require("./indeed");
const linkedin   = require("./linkedin");
const tokyodev   = require("./tokyodev");
const devjapan   = require("./devjapan");

/**
 * Array semua sumber yang tersedia.
 * Setiap sumber harus punya: { id, label, searchJobs }
 * Tandai usePuppeteer: true untuk sumber yang butuh headless browser
 * (dipakai di cron — sumber puppeteer di-skip otomatis karena berat)
 */
const SOURCES = [
  { ...glints,     usePuppeteer: false },
  { ...jobstreet,  usePuppeteer: true  },  // Puppeteer — skip di cron
  { ...hennge,     usePuppeteer: false },
  { ...mercari,    usePuppeteer: false },
  { ...kalibrr,    usePuppeteer: false },
  { ...techinasia, usePuppeteer: false },
  { ...indeed,     usePuppeteer: false },
  { ...linkedin,   usePuppeteer: false },
  { ...tokyodev,   usePuppeteer: false },
  { ...devjapan,   usePuppeteer: false },
];

/** Map id → source object untuk lookup cepat */
const BY_ID = Object.fromEntries(SOURCES.map((s) => [s.id, s]));

/** Sumber yang aman untuk cron (tanpa Puppeteer) */
const CRON_SOURCES = SOURCES.filter((s) => !s.usePuppeteer);

module.exports = { SOURCES, BY_ID, CRON_SOURCES };
