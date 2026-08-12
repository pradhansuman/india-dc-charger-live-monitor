#!/usr/bin/env node
/* OpenStreetMap gap-filler for India DC Charger Live Monitor
 *
 * Queries Overpass for DC-capable charging stations in states/UTs where
 * OpenChargeMap has none, then merges them into data/stations.js
 * (source-marked as "osm"). Re-run anytime to pick up new mapping:
 *
 *   node scripts/update-osm-gaps.js
 *
 * Verified 2026-08-13: the gap states have almost nothing mapped yet
 * (Bihar: 1 station total on OSM, 0 DC; Delhi sanity check: 152).
 * The script is the mechanism — results depend on OSM contributors.
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const DATA_FILE = path.join(ROOT, "data", "stations.js");

const ENDPOINTS = [
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass-api.de/api/interpreter",
  "https://overpass.private.coffee/api/interpreter"
];

const GAP_STATES = [
  ["Arunachal Pradesh", "Arunachal Pradesh"],
  ["Bihar", "Bihar"],
  ["Chhattisgarh", "Chhattisgarh"],
  ["Manipur", "Manipur"],
  ["Meghalaya", "Meghalaya"],
  ["Mizoram", "Mizoram"],
  ["Nagaland", "Nagaland"],
  ["Sikkim", "Sikkim"],
  ["Tripura", "Tripura"],
  ["Andaman and Nicobar Islands", "Andaman and Nicobar Islands"],
  ["Chandigarh", "Chandigarh"],
  ["Dadra and Nagar Haveli and Daman and Diu", "Dadra and Nagar Haveli"],
  ["Ladakh", "Ladakh"],
  ["Lakshadweep", "Lakshadweep"]
];

const DC_SOCKETS = ["socket:type2_combo", "socket:ccs", "socket:chademo", "socket:gbt", "socket:tesla_supercharger", "socket:bharat_dc"];

function qty(v) { const n = parseInt(v, 10); return isNaN(n) || n < 1 ? 1 : n; }
function kw(v) { const m = String(v || "").match(/(\d+(?:\.\d+)?)\s*kw/i); return m ? parseFloat(m[1]) : null; }

function transform(el, state) {
  const t = el.tags || {};
  const node = el.type === "node";
  const lat = node ? el.lat : (el.center && el.center.lat);
  const lon = node ? el.lon : (el.center && el.center.lon);
  if (lat === undefined || lon === undefined) return null;
  const keys = Object.keys(t);
  let status = "operational";
  if (keys.some(k => /^(disused|abandoned|removed)/.test(k)) || t["disused:amenity"]) status = "not_operational";
  else if (keys.some(k => /^(planned|construction|proposed)/.test(k))) status = "planned";
  let dcFast = 0, ultra = 0, ccs2 = 0, chademo = 0, gbt = 0, bharatDC = 0;
  const powers = {};
  DC_SOCKETS.forEach(sock => {
    if (t[sock] === undefined || t[sock] === "no") return;
    const n = qty(t[sock]);
    const out = kw(t[sock + ":output"]);
    if (out !== null) powers[Math.round(out)] = true;
    if (out !== null && out >= 150) ultra += n; else dcFast += n;
    if (sock === "socket:type2_combo" || sock === "socket:ccs") ccs2 += n;
    if (sock === "socket:chademo") chademo += n;
    if (sock === "socket:gbt") gbt += n;
    if (sock === "socket:bharat_dc") bharatDC += n;
  });
  if (dcFast + ultra === 0) return null;
  return {
    name: t.name || (t.operator || "EV") + " Charging Station",
    operator: t.operator || t.brand || "Unknown",
    state, district: t["addr:district"] || "", city: t["addr:city"] || t["addr:town"] || t["addr:village"] || "",
    lat: Math.round(lat * 1e6) / 1e6, lng: Math.round(lon * 1e6) / 1e6,
    total: dcFast + ultra, dcFast, ultra, ccs2, chademo, gbt, bharatDC,
    power: Object.keys(powers).map(Number).sort((a, b) => a - b).join(", "),
    is24x7: /24\/7/.test(t["opening_hours"] || ""), status, ts: Date.now(), src: "osm"
  };
}

async function queryState(osmName) {
  const q = `[out:json][timeout:25];relation["name"="${osmName}"]["boundary"="administrative"]["admin_level"=4];map_to_area->.a;nwr["amenity"="charging_station"](area.a);out center tags;`;
  for (let pass = 0; pass < 2; pass++) {
    for (const ep of ENDPOINTS) {
      try {
        const r = await fetch(ep, {
          method: "POST",
          headers: { "User-Agent": "ev-charging-dashboard-data/1.0 (supplement)", "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ data: q }),
          signal: AbortSignal.timeout(30000)
        });
        if (!r.ok) continue;
        const j = await r.json();
        const seen = new Set(); const out = [];
        (j.elements || []).forEach(el => {
          const s = transform(el, "?");
          if (!s) return;
          const key = Math.round(s.lat * 500) + ":" + Math.round(s.lng * 500);
          if (seen.has(key)) return;
          seen.add(key); out.push(s);
        });
        return out;
      } catch (e) { /* try next endpoint */ }
      await new Promise(s => setTimeout(s, 2000));
    }
    await new Promise(s => setTimeout(s, 6000));
  }
  return null;
}

(async () => {
  let added = 0;
  const existing = fs.existsSync(DATA_FILE)
    ? JSON.parse(fs.readFileSync(DATA_FILE, "utf8").replace(/^.*?=\s*/, "").replace(/;\s*$/, ""))
    : [];
  const existingKeys = new Set(existing.map(s => Math.round(s.lat * 500) + ":" + Math.round(s.lng * 500)));

  for (const [osmName, ourState] of GAP_STATES) {
    const res = await queryState(osmName);
    if (res === null) { console.log(osmName.padEnd(38), "FAILED (servers busy — retry later)"); continue; }
    res.forEach(s => {
      s.state = ourState;
      const key = Math.round(s.lat * 500) + ":" + Math.round(s.lng * 500);
      if (existingKeys.has(key)) return;
      existingKeys.add(key);
      existing.push(s);
      added++;
    });
    console.log(osmName.padEnd(38), res.length + " found, " + (res.length ? "" : "") + "merged so far: " + added);
    await new Promise(s => setTimeout(s, 1500));
  }

  if (added > 0) {
    const header = `// OpenChargeMap snapshot for India (DC-capable) + OpenStreetMap gap supplement.\n// Fetched from https://api.openchargemap.io/v3/poi (countrycode=IN) and Overpass (gap states) on ${new Date().toISOString().slice(0, 10)}.\n// ${existing.length} stations total (${added} from OSM supplement). Offline fallback for config.js sources.\n`;
    fs.writeFileSync(DATA_FILE, header + "window.DC_STATIONS = " + JSON.stringify(existing) + ";\n");
    console.log("\nMerged", added, "OSM stations into data/stations.js (" + existing.length + " total)");
  } else {
    console.log("\nNo new OSM stations to merge. Gap states still unmapped in open data.");
  }
})();
