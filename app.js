/* India DC Charger Live Monitor — filters + map only */
(function () {
  "use strict";

  var CONFIG = window.APP_CONFIG || { liveFeedUrl: null, apiKey: null, ocmApiKey: null, ocmRefreshMs: 900000, refreshMs: 30000 };
  var SNAPSHOT = Array.isArray(window.DC_STATIONS) ? window.DC_STATIONS : [];

  var HAS_FEED = !!CONFIG.liveFeedUrl;
  var HAS_OCM = !!CONFIG.ocmApiKey;
  var REFRESH_MS = HAS_FEED
    ? Math.max(5000, CONFIG.refreshMs || 30000)
    : HAS_OCM
      ? Math.max(60000, CONFIG.ocmRefreshMs || 900000)
      : Math.max(5000, CONFIG.refreshMs || 30000);

  var OCM_BASE = "https://api.openchargemap.io/v3/poi";
  var OCM_PAGE = 2000;

  var state = {
    data: [],
    q: "",
    stateFilter: "",
    operatorFilter: "",
    statusFilter: "",
    source: "snapshot",
    lastRefresh: null
  };

  var map = null;
  var clusterGroup = null;
  var markers = [];
  var timer = null;
  var countdownLeft = 0;

  /* ---------- helpers ---------- */

  function statusGroup(s) {
    if (s === "operational") return "online";
    if (s === "under_maintenance") return "maintenance";
    return "offline"; // planned, power_failure, communication_failure, temporarily_unavailable, permanently_closed, ...
  }

  function statusLabel(s) {
    return String(s || "unknown").replace(/_/g, " ").replace(/\b\w/g, function (c) { return c.toUpperCase(); });
  }

  function fmtTime(ts) {
    if (!ts) return "—";
    var d = new Date(ts);
    if (isNaN(d.getTime())) return "—";
    var diff = Date.now() - d.getTime();
    var rel;
    if (diff < 60000) rel = "just now";
    else if (diff < 3600000) rel = Math.floor(diff / 60000) + "m ago";
    else if (diff < 86400000) rel = Math.floor(diff / 3600000) + "h ago";
    else rel = Math.floor(diff / 86400000) + "d ago";
    return rel + " · " + d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  function byId(id) { return document.getElementById(id); }

  function toast(msg) {
    var t = byId("toast");
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(t._h);
    t._h = setTimeout(function () { t.hidden = true; }, 7000);
  }

  // Clean dirty state names from OpenChargeMap (trim / case / typos / abbreviations)
  var STATE_ALIAS = {
    "tamil nadu": "Tamil Nadu", "tamilnadu": "Tamil Nadu", "tamil nasdu": "Tamil Nadu", "chennai": "Tamil Nadu", "villupuram": "Tamil Nadu",
    "karnataka": "Karnataka", "karnatak": "Karnataka", "bangalore urban": "Karnataka",
    "kerala": "Kerala", "keral": "Kerala", "keraka": "Kerala", "lerala": "Kerala",
    "maharashtra": "Maharashtra", "mahrashtra": "Maharashtra",
    "uttarakhand": "Uttarakhand", "uttarakhnad": "Uttarakhand", "west bengal": "West Bengal",
    "uttar pradesh": "Uttar Pradesh", "rajasthan": "Rajasthan", "gujarat": "Gujarat", "haryana": "Haryana",
    "delhi": "Delhi", "punjab": "Punjab", "goa": "Goa", "gj": "Gujarat", "mh": "Maharashtra", "mp": "Madhya Pradesh", "rj": "Rajasthan",
    "andhra pradesh": "Andhra Pradesh", "himachal pradesh": "Himachal Pradesh", "jammu and kashmir": "Jammu and Kashmir",
    "jharkhand": "Jharkhand", "madhya pradesh": "Madhya Pradesh", "puducherry": "Puducherry", "telangana": "Telangana",
    "dadra and nagar haveli": "Dadra and Nagar Haveli", "odisha": "Odisha", "assam": "Assam", "chandigarh": "Chandigarh",
    "sikkim": "Sikkim", "mizoram": "Mizoram", "manipur": "Manipur", "meghalaya": "Meghalaya", "nagaland": "Nagaland",
    "tripura": "Tripura", "arunachal pradesh": "Arunachal Pradesh", "ladakh": "Ladakh", "bihar": "Bihar", "chhattisgarh": "Chhattisgarh",
    "india": "" // OCM entries that put the country in the state field
  };
  function normalizeState(s) {
    if (!s) return "";
    var v = String(s).replace(/\s+/g, " ").trim();
    var k = v.toLowerCase();
    if (STATE_ALIAS[k] !== undefined) return STATE_ALIAS[k];
    if (v === v.toUpperCase() || v === v.toLowerCase())
      return v.split(" ").map(function (w) {
        return (w.toLowerCase() === "and" || w.toLowerCase() === "of") ? w.toLowerCase() : w[0].toUpperCase() + w.slice(1).toLowerCase();
      }).join(" ");
    return v;
  }

  /* ---------- data loading ---------- */

  var FOOTERS = {
    snapshot: "OpenChargeMap snapshot · " + SNAPSHOT.length + " DC stations (fetched 2026-08-13) · auto-refresh",
    ocm: "OpenChargeMap live · auto-refresh",
    live: "Custom live feed · auto-refresh"
  };

  function applyData(list, source) {
    list.forEach(function (s) { s.state = normalizeState(s.state); });
    state.data = list;
    state.lastRefresh = Date.now();
    state.source = source;

    var badge = byId("mode-badge");
    if (source === "ocm") { badge.textContent = "OCM LIVE"; badge.className = "badge badge-ocm"; }
    else if (source === "live") { badge.textContent = "LIVE FEED"; badge.className = "badge badge-live"; }
    else { badge.textContent = "SNAPSHOT"; badge.className = "badge badge-snapshot"; }

    var dot = byId("live-dot");
    dot.className = "live-dot" + (source !== "snapshot" ? " live" : "");
    byId("last-updated").textContent = "updated " + fmtTime(state.lastRefresh);
    byId("footer-source").textContent = FOOTERS[source] || "";

    populateFilters();
    render();
  }

  function loadSnapshot() {
    applyData(SNAPSHOT.slice(), "snapshot");
  }

  function normalizeStation(s) {
    return {
      name: s.name, operator: s.operator, state: s.state,
      district: s.district || "", city: s.city,
      lat: Number(s.lat), lng: Number(s.lng),
      total: Number(s.total || 0),
      dcFast: Number(s.dcFast || 0), ultra: Number(s.ultra || 0),
      ccs2: Number(s.ccs2 || 0), chademo: Number(s.chademo || 0),
      gbt: Number(s.gbt || 0), bharatDC: Number(s.bharatDC || 0),
      power: s.power || "", is24x7: !!s.is24x7,
      status: s.status || "unknown", ts: s.ts || Date.now()
    };
  }

  function loadFeed() {
    var headers = {};
    if (CONFIG.apiKey) headers["X-API-Key"] = CONFIG.apiKey;
    return fetch(CONFIG.liveFeedUrl, { headers: headers, cache: "no-store" })
      .then(function (r) {
        if (!r.ok) throw new Error("HTTP " + r.status);
        return r.json();
      })
      .then(function (arr) {
        if (!Array.isArray(arr)) throw new Error("feed must return a JSON array");
        applyData(arr.map(normalizeStation), "live");
        return true;
      })
      .catch(function (err) {
        toast("Live feed unavailable (" + err.message + "). Showing bundled snapshot data.");
        if (!state.data.length) loadSnapshot();
        return false;
      });
  }

  /* ---------- OpenChargeMap ---------- */

  function fetchOcmPage(offset) {
    var url = OCM_BASE +
      "?key=" + encodeURIComponent(CONFIG.ocmApiKey) +
      "&countrycode=IN&maxresults=" + OCM_PAGE +
      "&offset=" + offset + "&verbose=false";
    return fetch(url, { headers: { "x-api-key": CONFIG.ocmApiKey }, cache: "no-store" })
      .then(function (r) {
        if (!r.ok) throw new Error("OCM HTTP " + r.status);
        return r.json();
      });
  }

  function ocmToStation(p) {
    var addr = p.AddressInfo || {};
    // DC detection: Level-3 flag OR a DC connector type (OCM imports often mislabel levels)
    var DC_TYPE_RE = /ccs|chademo|gbt|supercharger|bharat/i;
    var dc = (p.Connections || []).filter(function (c) {
      if (c.LevelID === 3) return true;
      return DC_TYPE_RE.test((c.ConnectionType && c.ConnectionType.Title) || "");
    });
    var fast = 0, ultra = 0, ccs2 = 0, chademo = 0, gbt = 0, bharatDC = 0;
    var powers = {};
    dc.forEach(function (c) {
      var qty = c.Quantity || 1;
      var kw = c.PowerKW;
      if (kw !== null && kw !== undefined) powers[Math.round(kw)] = true;
      if (kw >= 150) ultra += qty; else fast += qty;
      var t = (c.ConnectionType && c.ConnectionType.Title) || "";
      if (/ccs/i.test(t)) ccs2 += qty;
      if (/chademo/i.test(t)) chademo += qty;
      if (/gbt/i.test(t)) gbt += qty;
      if (/bharat/i.test(t)) bharatDC += qty;
    });
    var st = p.StatusType || {};
    var status = st.IsOperational ? "operational"
      : String(st.Title || "unknown").toLowerCase().replace(/\s+/g, "_");
    var ts = p.DateLastStatusUpdate ? new Date(p.DateLastStatusUpdate).getTime() : Date.now();
    return {
      ocmId: p.ID,
      name: addr.Title || ("Station " + p.ID),
      operator: (p.OperatorInfo && p.OperatorInfo.Title) || "Unknown",
      state: addr.StateOrProvince || "",
      district: addr.AddressLine1 || "",
      city: addr.Town || "",
      lat: Number(addr.Latitude),
      lng: Number(addr.Longitude),
      total: Number(p.NumberOfPoints || 0),
      dcFast: fast,
      ultra: ultra,
      ccs2: ccs2,
      chademo: chademo,
      gbt: gbt,
      bharatDC: bharatDC,
      power: Object.keys(powers).map(Number).sort(function (a, b) { return a - b; }).join(", "),
      is24x7: p.IsOpen24Hours === true,
      status: status,
      ts: ts
    };
  }

  function loadOcm() {
    var all = [];
    var offset = 0;
    var fetchPage = function () {
      return fetchOcmPage(offset).then(function (page) {
        if (!Array.isArray(page)) throw new Error("unexpected OCM response");
        all = all.concat(page);
        if (page.length === OCM_PAGE && offset < OCM_PAGE * 9) {
          offset += OCM_PAGE;
          return fetchPage();
        }
        return all;
      });
    };
    return fetchPage()
      .then(function (pois) {
        var stations = pois
          .map(ocmToStation)
          .filter(function (s) { return (s.dcFast + s.ultra) > 0; }); // keep DC-capable only
        applyData(stations, "ocm");
        return stations.length;
      })
      .catch(function (err) {
        toast("OpenChargeMap fetch failed (" + err.message + "). Showing bundled snapshot data.");
        if (!state.data.length) loadSnapshot();
        return 0;
      });
  }

  /* ---------- timer ---------- */

  function refresh() {
    if (HAS_FEED) loadFeed();
    else if (HAS_OCM) loadOcm();
    else {
      state.lastRefresh = Date.now();
      byId("last-updated").textContent = "updated " + fmtTime(state.lastRefresh);
      render();
    }
  }

  function startTimer() {
    countdownLeft = Math.ceil(REFRESH_MS / 1000);
    tick();
    timer = setInterval(function () {
      countdownLeft -= 1;
      if (countdownLeft <= 0) {
        refresh();
        countdownLeft = Math.ceil(REFRESH_MS / 1000);
      }
      tick();
    }, 1000);
  }

  function tick() {
    var mins = Math.round(REFRESH_MS / 60000);
    byId("footer-refresh").textContent = "refreshes every " + (mins >= 1 ? mins + " min" : Math.round(REFRESH_MS / 1000) + "s");
  }

  /* ---------- filtering ---------- */

  function filtered() {
    var q = state.q.trim().toLowerCase();
    return state.data.filter(function (s) {
      if (state.stateFilter && s.state !== state.stateFilter) return false;
      if (state.operatorFilter && s.operator !== state.operatorFilter) return false;
      if (state.statusFilter && statusGroup(s.status) !== state.statusFilter) return false;
      if (q) {
        var hay = (s.name + " " + s.operator + " " + s.city + " " + s.state + " " + (s.district || "")).toLowerCase();
        if (hay.indexOf(q) === -1) return false;
      }
      return true;
    });
  }

  function populateFilters() {
    var states = {}, ops = {};
    state.data.forEach(function (s) {
      if (s.state) states[s.state] = true;
      if (s.operator) ops[s.operator] = true;
    });
    fillSelect(byId("state-filter"), Object.keys(states).sort(), state.stateFilter, "All states");
    fillSelect(byId("operator-filter"), Object.keys(ops).sort(), state.operatorFilter, "All operators");
  }

  function fillSelect(sel, values, current, allLabel) {
    var keep = sel.value;
    sel.innerHTML = "";
    var optAll = document.createElement("option");
    optAll.value = "";
    optAll.textContent = allLabel;
    sel.appendChild(optAll);
    values.forEach(function (v) {
      var o = document.createElement("option");
      o.value = v;
      o.textContent = v;
      sel.appendChild(o);
    });
    if (current) sel.value = current;
    else sel.value = keep && values.indexOf(keep) !== -1 ? keep : "";
  }

  /* ---------- rendering (map only) ---------- */

  function render() {
    var rows = filtered();
    renderMap(rows);
    byId("result-count").textContent = rows.length === state.data.length
      ? "All " + rows.length + " DC chargers"
      : rows.length + " of " + state.data.length + " DC chargers";
    byId("last-updated").textContent = "updated " + fmtTime(state.lastRefresh);
  }

  /* ---------- map ---------- */

  function initMap() {
    if (typeof L === "undefined") {
      byId("map").innerHTML = "<div style='padding:40px;color:#8fa3c4;text-align:center'>Map library failed to load (CDN blocked or offline). Check your internet connection and refresh.</div>";
      byId("map-note").textContent = "";
      return;
    }
    map = L.map("map", { worldCopyJump: true, zoomControl: true });
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: "&copy; OpenStreetMap contributors"
    }).addTo(map);
    try {
      if (typeof L.markerClusterGroup === "function") {
        clusterGroup = L.markerClusterGroup({
          maxClusterRadius: 45,
          spiderfyOnMaxZoom: true,
          showCoverageOnHover: false,
          disableClusteringAtZoom: 12 // show individual dots at city level
        });
        map.addLayer(clusterGroup);
      }
    } catch (e) { clusterGroup = null; }
  }

  function renderMap(rows) {
    if (!map) return;
    markers.forEach(function (m) { (clusterGroup || map).removeLayer(m); });
    markers = [];
    if (!rows.length) return;
    var bounds = [];
    rows.forEach(function (s) {
      var g = statusGroup(s.status);
      var color = g === "online" ? "#22c55e" : g === "maintenance" ? "#f59e0b" : "#ef4444";
      var m = L.circleMarker([s.lat, s.lng], {
        radius: 7,
        color: color,
        fillColor: color,
        fillOpacity: 0.85,
        weight: 1.5,
        opacity: 1
      });
      m.bindPopup(
        "<div class='pop-title'>" + esc(s.name) + "</div>" +
        "<div class='pop-meta'>" + esc(s.operator) + " · " + esc(s.city) + ", " + esc(s.state) + "</div>" +
        "<div class='pop-grid'>" +
        "<span>DC fast</span><b>" + s.dcFast + "</b>" +
        "<span>Ultra-fast</span><b>" + s.ultra + "</b>" +
        "<span>CCS2</span><b>" + s.ccs2 + "</b>" +
        "<span>CHAdeMO</span><b>" + s.chademo + "</b>" +
        "<span>GBT</span><b>" + s.gbt + "</b>" +
        "<span>Power</span><b>" + esc(s.power || "—") + "</b>" +
        "<span>24×7</span><b>" + (s.is24x7 ? "Yes" : "No") + "</b>" +
        "<span>Status</span><b>" + esc(statusLabel(s.status)) + "</b>" +
        "</div>"
      );
      if (clusterGroup) clusterGroup.addLayer(m);
      else m.addTo(map);
      markers.push(m);
      bounds.push([s.lat, s.lng]);
    });
    if (bounds.length === 1) map.setView(bounds[0], 12);
    else if (bounds.length > 1) map.fitBounds(bounds, { padding: [30, 30], maxZoom: 14 });
  }

  /* ---------- events ---------- */

  function bindEvents() {
    byId("search").addEventListener("input", function (e) { state.q = e.target.value; render(); });
    byId("state-filter").addEventListener("change", function (e) { state.stateFilter = e.target.value; render(); });
    byId("operator-filter").addEventListener("change", function (e) { state.operatorFilter = e.target.value; render(); });
    Array.prototype.forEach.call(document.querySelectorAll(".seg"), function (btn) {
      btn.addEventListener("click", function () {
        state.statusFilter = btn.dataset.status;
        Array.prototype.forEach.call(document.querySelectorAll(".seg"), function (b) {
          var on = b === btn;
          b.classList.toggle("active", on);
          b.setAttribute("aria-pressed", on ? "true" : "false");
        });
        render();
      });
    });
    byId("clear-filters").addEventListener("click", function () {
      state.q = ""; state.stateFilter = ""; state.operatorFilter = ""; state.statusFilter = "";
      byId("search").value = "";
      byId("state-filter").value = "";
      byId("operator-filter").value = "";
      Array.prototype.forEach.call(document.querySelectorAll(".seg"), function (b) {
        var on = b.dataset.status === "";
        b.classList.toggle("active", on);
        b.setAttribute("aria-pressed", on ? "true" : "false");
      });
      render();
    });
  }

  /* ---------- boot ---------- */

  function boot() {
    bindEvents();
    initMap();
    loadSnapshot(); // instant paint, then async sources replace it
    startTimer();
    if (HAS_FEED) {
      loadFeed();
      toast("Live feed configured — connecting to " + CONFIG.liveFeedUrl);
    } else if (HAS_OCM) {
      loadOcm().then(function (n) {
        if (n > 0) toast("OpenChargeMap loaded — " + n + " DC-capable stations in India.");
      });
    }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
