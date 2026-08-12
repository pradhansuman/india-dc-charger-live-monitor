#!/usr/bin/env node
/*
 * Monthly data refresh for the India EV Charger Map.
 *
 * What it does:
 *   1. Reads the OCM API key from ../config.js (browser-style file, evaluated in a sandbox).
 *   2. Pulls every OpenChargeMap POI for India (paginated, no DC filter — AC + DC).
 *   3. Transforms stations with the SAME logic as app.js (extracted at runtime, single source of truth).
 *   4. Writes ../data/stations.js.
 *   5. Re-checks gap states via scripts/update-osm-gaps.js and merges anything new (best-effort).
 *   6. Commits + pushes to GitHub if anything changed (Render auto-redeploys).
 *
 * Usage: node scripts/refresh-data.js
 * Safe to run repeatedly; no changes = no commit.
 */
"use strict";

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const OCM_BASE = "https://api.openchargemap.io/v3/poi";
const OCM_PAGE = 2000;
const MAX_PAGES = 10;

function loadConfig() {
  const src = fs.readFileSync(path.join(ROOT, "config.js"), "utf8");
  const sandbox = { window: {} };
  const vm = require("vm");
  vm.createContext(sandbox);
  vm.runInContext(src + "\n;globalThis.__cfg = window.APP_CONFIG;", sandbox);
  return sandbox.__cfg || {};
}

// Extract the transform + state normalizer straight from app.js so the
// snapshot always matches what the browser does.
function extractFromAppJs() {
  const code = fs.readFileSync(path.join(ROOT, "app.js"), "utf8");
  const grab = (name) => {
    const start = code.indexOf("function " + name + "(");
    if (start < 0) throw new Error("function " + name + " not found in app.js");
    const brace = code.indexOf("{", start);
    let depth = 0, i = brace;
    for (; i < code.length; i++) {
      if (code[i] === "{") depth++;
      else if (code[i] === "}") { depth--; if (depth === 0) break; }
    }
    return code.slice(start, i + 1);
  };
  const aliasStart = code.indexOf("var STATE_ALIAS = ");
  const aliasEnd = code.indexOf(";", code.indexOf("};", aliasStart)) + 1;
  const stateFn = grab("normalizeState");
  return { aliasSrc: code.slice(aliasStart, aliasEnd), stateFn, ocmFn: grab("ocmToStation") };
}

async function fetchAll(key) {
  const out = [];
  for (let offset = 0; offset < OCM_PAGE * MAX_PAGES; offset += OCM_PAGE) {
    const url = OCM_BASE + "?" + "key" + "=" + encodeURIComponent(key) +
      "&countrycode=IN&maxresults=" + OCM_PAGE +
      "&offset=" + offset + "&verbose=false";
    const res = await fetch(url, { headers: { "x-api-key": key }, cache: "no-store" });
    if (!res.ok) throw new Error("OCM HTTP " + res.status);
    const page = await res.json();
    if (!Array.isArray(page)) throw new Error("unexpected OCM response");
    out.push(...page);
    console.log("  fetched offset", offset, "→", out.length, "POIs");
    if (page.length < OCM_PAGE) break;
  }
  return out;
}

function buildData(pois) {
  const { aliasSrc, stateFn, ocmFn } = extractFromAppJs();
  const sandbox = {};
  const vm = require("vm");
  vm.createContext(sandbox);
  vm.runInContext(aliasSrc + "\n" + stateFn + "\n" + ocmFn +
    "\n;globalThis.__ocm = ocmToStation; globalThis.__norm = normalizeState;", sandbox);
  const ocmToStation = sandbox.__ocm;
  const norm = sandbox.__norm;
  const transformed = pois.map((p) => {
    const s = ocmToStation(p);
    // Keep the local data-quality patch for POI 301542 (wrong coords upstream).
    if (p.ID === 301542) { s.lat = 11.3410; s.lng = 77.7170; }
    return s;
  });
  let stations = transformed.filter((s) => s.lat > 5 && s.lat < 40 && s.lng > 65 && s.lng < 100);
  stations = stations.map((s) => { s.state = norm(s.state); return s; });
  return stations.map((s) => ({
    name: s.name, operator: s.operator, state: s.state, district: s.district, city: s.city,
    lat: s.lat, lng: s.lng, total: s.total, acChargers: s.acChargers, dcFast: s.dcFast, ultra: s.ultra,
    ccs2: s.ccs2, chademo: s.chademo, gbt: s.gbt, bharatDC: s.bharatDC,
    power: s.power, is24x7: s.is24x7, status: s.status, ts: s.ts
  }));
}

function writeSnapshot(stations) {
  const dc = stations.filter((s) => s.dcFast + s.ultra > 0).length;
  const ac = stations.length - dc;
  const states = new Set(stations.map((s) => s.state).filter(Boolean)).size;
  const header = "// OpenChargeMap snapshot for India — ALL stations (AC + DC).\n" +
    "// Fetched from https://api.openchargemap.io/v3/poi (countrycode=IN) on " + new Date().toISOString().slice(0, 10) + ".\n" +
    "// " + stations.length + " stations total (" + dc + " DC-capable, " + ac + " AC-only) across " + states + " states/UTs.\n" +
    "// Offline fallback for config.js sources. States normalized.\n";
  fs.writeFileSync(path.join(ROOT, "data", "stations.js"), header + "window.DC_STATIONS = " + JSON.stringify(stations) + ";\n");
  return { total: stations.length, dc, ac, states };
}

function runGapCheck() {
  const gap = path.join(__dirname, "update-osm-gaps.js");
  if (!fs.existsSync(gap)) { console.log("gap script not present, skipping"); return; }
  try {
    execFileSync(process.execPath, [gap], { stdio: ["ignore", "pipe", "pipe"], timeout: 120000 });
    console.log("gap check ran (output above)");
  } catch (e) {
    console.log("gap check failed (non-fatal):", (e.message || "").split("\n")[0]);
  }
}

function git(...args) {
  try { return execFileSync("git", ["-c", "user.name=pradhansuman", "-c", "user.email=37845121+pradhansuman@users.noreply.github.com", ...args], { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"] }).toString().trim(); }
  catch (e) { throw new Error("git " + args.join(" ") + " failed: " + ((e.stderr || "").toString().split("\n")[0] || e.message)); }
}

async function main() {
  const cfg = loadConfig();
  if (!cfg.ocmApiKey) throw new Error("no ocmApiKey in config.js — cannot refresh");
  console.log("pulling OpenChargeMap (India, all station types)…");
  const pois = await fetchAll(cfg.ocmApiKey);
  const stations = buildData(pois);
  const stats = writeSnapshot(stations);
  console.log("snapshot:", JSON.stringify(stats));

  runGapCheck();
  const before = git("status").split("\n");
  const changed = before.some((l) => /^\s*[AMDRCU?]/.test(l)) || before.some((l) => l.startsWith("??"));
  if (!changed) { console.log("no changes — nothing to commit"); return; }
  git("add", "-A");
  git("commit", "-m", "chore: monthly OCM data refresh — " + stats.total + " stations (" + stats.dc + " DC / " + stats.ac + " AC), " + stats.states + " states");
  git("push", "origin", "main");
  console.log("committed and pushed");
}

main().catch((e) => { console.error("refresh failed:", e.message); process.exit(1); });
