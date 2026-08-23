// 2026-07-06 registry semua sumber lowongan yang bisa dipilih di frontend
const jobstreet = require("./jobstreet");
const hennge = require("./hennge");
const glints = require("./glints");
const mercari = require("./mercari");

const SOURCES = [jobstreet, hennge, glints, mercari];
const BY_ID = Object.fromEntries(SOURCES.map((s) => [s.id, s]));

module.exports = { SOURCES, BY_ID };
