/* India EV Charger Map — all stations (AC + DC), map only, no filters */
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

  var data = [];
  var map = null;
  var clusterGroup = null;
  var markers = [];

  /* ---------- helpers ---------- */

  function statusGroup(s) {
    if (s === "operational") return "online";
    if (s === "under_maintenance") return "maintenance";
    return "offline";
  }

  function statusLabel(s) {
    return String(s || "unknown").replace(/_/g, " ").replace(/\b\w/g, function (c) { return c.toUpperCase(); });
  }

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  function byId(id) { return document.getElementById(id); }

  function fmtAge(ts) {
    if (!ts) return "—";
    var d = Date.now() - ts;
    if (d < 0) d = 0;
    if (d < 60000) return "just now";
    if (d < 3600000) return Math.floor(d / 60000) + "m ago";
    if (d < 86400000) return Math.floor(d / 3600000) + "h ago";
    if (d < 2592000000) return Math.floor(d / 86400000) + "d ago";
    return new Date(ts).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
  }

  function toast(msg) {
    var t = byId("toast");
    if (!t) return;
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
    "india": ""
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

  /* ---------- data ---------- */

  function applyData(list) {
    list.forEach(function (s) { s.state = normalizeState(s.state); });
    data = list;
    render();
  }

  function loadSnapshot() {
    applyData(SNAPSHOT.slice());
  }

  function normalizeStation(s) {
    return {
      name: s.name, operator: s.operator, state: s.state,
      district: s.district || "", city: s.city,
      lat: Number(s.lat), lng: Number(s.lng),
      total: Number(s.total || 0),
      acChargers: Number(s.acChargers || 0),
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
        applyData(arr.map(normalizeStation));
        return true;
      })
      .catch(function (err) {
        toast("Live feed unavailable (" + err.message + "). Showing bundled data.");
        if (!data.length) loadSnapshot();
        return false;
      });
  }

  /* ---------- OpenChargeMap (all stations, AC + DC) ---------- */

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
    var DC_TYPE_RE = /ccs|chademo|gbt|supercharger|bharat/i;
    var fast = 0, ultra = 0, ccs2 = 0, chademo = 0, gbt = 0, bharatDC = 0, ac = 0;
    var powers = {};
    (p.Connections || []).forEach(function (c) {
      var qty = c.Quantity || 1;
      var isDC = c.LevelID === 3 || DC_TYPE_RE.test((c.ConnectionType && c.ConnectionType.Title) || "");
      if (!isDC) { ac += qty; return; }
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
      name: addr.Title || ("Station " + p.ID),
      operator: (p.OperatorInfo && p.OperatorInfo.Title) || "Unknown",
      state: addr.StateOrProvince || "",
      district: addr.AddressLine1 || "",
      city: addr.Town || "",
      lat: Number(addr.Latitude),
      lng: Number(addr.Longitude),
      total: Number(p.NumberOfPoints || 0),
      acChargers: ac,
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
          .filter(function (s) {
            return s.lat > 5 && s.lat < 40 && s.lng > 65 && s.lng < 100; // valid India coords
          });
        applyData(stations);
        return stations.length;
      })
      .catch(function (err) {
        toast("OpenChargeMap fetch failed (" + err.message + "). Showing bundled data.");
        if (!data.length) loadSnapshot();
        return 0;
      });
  }

  /* ---------- refresh ---------- */

  function refresh() {
    if (HAS_FEED) loadFeed();
    else if (HAS_OCM) loadOcm();
  }

  /* ---------- map ---------- */

  function initMap() {
    if (typeof L === "undefined") {
      byId("map").innerHTML = "<div style='padding:40px;color:#8fa3c4;text-align:center'>Map library failed to load (CDN blocked or offline). Check your internet connection and refresh.</div>";
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
          disableClusteringAtZoom: 12
        });
        map.addLayer(clusterGroup);
      }
    } catch (e) { clusterGroup = null; }

    // Fill distance + navigation when a popup opens (depends on live user location).
    map.on("popupopen", function (e) {
      var el = e.popup.getElement();
      if (!el) return;
      var box = el.querySelector(".pop-data");
      if (!box) return;
      var lat = parseFloat(box.getAttribute("data-lat"));
      var lng = parseFloat(box.getAttribute("data-lng"));
      var dv = el.querySelector(".dist-val");
      if (dv) {
        if (userPos && !isNaN(lat) && !isNaN(lng)) {
          var meters = map.distance([userPos.lat, userPos.lng], [lat, lng]);
          dv.textContent = meters < 1000 ? Math.round(meters) + " m" : (meters / 1000).toFixed(1) + " km";
        } else {
          dv.textContent = "—";
        }
      }
      var nv = el.querySelector(".nav-btn");
      if (nv && !isNaN(lat) && !isNaN(lng)) {
        var dest = encodeURIComponent(lat + "," + lng);
        var origin = userPos ? "origin=" + encodeURIComponent(userPos.lat + "," + userPos.lng) + "&" : "";
        nv.href = "https://www.google.com/maps/dir/?api=1&" + origin + "destination=" + dest + "&travelmode=driving";
      }
    });

    var onResize = function () { if (map) map.invalidateSize(); };
    window.addEventListener("resize", onResize);
    window.addEventListener("orientationchange", function () { setTimeout(onResize, 250); });
  }

  function render() {
    if (!map) return;
    markers.forEach(function (m) { (clusterGroup || map).removeLayer(m); });
    markers = [];
    if (!data.length) return;
    var bounds = [];
    data.forEach(function (s) {
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
        "<span>AC</span><b>" + s.acChargers + "</b>" +
        "<span>DC fast</span><b>" + s.dcFast + "</b>" +
        "<span>Ultra-fast</span><b>" + s.ultra + "</b>" +
        "<span>CCS2</span><b>" + s.ccs2 + "</b>" +
        "<span>CHAdeMO</span><b>" + s.chademo + "</b>" +
        "<span>GBT</span><b>" + s.gbt + "</b>" +
        "<span>Power</span><b>" + esc(s.power || "—") + "</b>" +
        "<span>24×7</span><b>" + (s.is24x7 ? "Yes" : "No") + "</b>" +
        "<span>Status</span><b>" + esc(statusLabel(s.status)) + "</b>" +
        "<span>Updated</span><b>" + fmtAge(s.ts) + "</b>" +
        "</div>" +
        "<div class='pop-data' data-lat='" + s.lat + "' data-lng='" + s.lng + "'>" +
        "<div class='pop-nav'><span class='dist-label'>Distance</span><b class='dist-val'>—</b>" +
        "<a class='nav-btn' href='#' target='_blank' rel='noopener'>Navigate</a></div>" +
        "<a class='gmap-link' href='https://www.google.com/maps/search/" + encodeURIComponent("EV charging stations") + "/@" + s.lat + "," + s.lng + ",14z' target='_blank' rel='noopener'>More stations on Google Maps ↗</a>" +
        "</div>"
      );
      if (clusterGroup) clusterGroup.addLayer(m);
      else m.addTo(map);
      markers.push(m);
      bounds.push([s.lat, s.lng]);
    });
    if (bounds.length === 1) map.setView(bounds[0], 12);
    else if (bounds.length > 1) map.fitBounds(bounds, { padding: [24, 24], maxZoom: 13 });
  }

  /* ---------- near me ---------- */

  var userPos = null;
  var userLayer = null;
  var dogIconCached = null;

  // Cute dog marker for the user's location (inline SVG — no external image dependency).
  function dogIcon() {
    if (dogIconCached) return dogIconCached;
    dogIconCached = L.divIcon({
      html: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="26" height="26" style="filter:drop-shadow(0 1px 2px rgba(0,0,0,.45))">' +
        '<ellipse cx="15" cy="16" rx="10" ry="15" fill="#8d5a2b" transform="rotate(16 15 16)"/>' +
        '<ellipse cx="49" cy="16" rx="10" ry="15" fill="#8d5a2b" transform="rotate(-16 49 16)"/>' +
        '<ellipse cx="32" cy="33" rx="21" ry="18" fill="#c08552"/>' +
        '<ellipse cx="32" cy="40" rx="11" ry="8" fill="#e8c9a0"/>' +
        '<ellipse cx="22.5" cy="28.5" rx="3.4" ry="4" fill="#26221f"/>' +
        '<ellipse cx="41.5" cy="28.5" rx="3.4" ry="4" fill="#26221f"/>' +
        '<circle cx="21.3" cy="26.9" r="1.2" fill="#fff"/>' +
        '<circle cx="40.3" cy="26.9" r="1.2" fill="#fff"/>' +
        '<ellipse cx="32" cy="39.5" rx="4.6" ry="3.4" fill="#26221f"/>' +
        '<path d="M27.5 42.5 Q32 48.5 36.5 42.5 L35.4 49.5 Q32 52.5 28.6 49.5 Z" fill="#f2848f"/>' +
        '</svg>',
      className: "",
      iconSize: [26, 26],
      iconAnchor: [13, 24]
    });
    return dogIconCached;
  }

  function locateMe() {
    if (!map) return;
    if (!navigator.geolocation) { toast("Location is not supported on this device."); return; }
    toast("Locating you…");
    navigator.geolocation.getCurrentPosition(function (pos) {
      var lat = pos.coords.latitude, lng = pos.coords.longitude;
      userPos = { lat: lat, lng: lng };
      if (userLayer) map.removeLayer(userLayer);
      userLayer = L.layerGroup([
        L.marker([lat, lng], { icon: dogIcon(), zIndexOffset: 1000 }),
        L.circle([lat, lng], { radius: 25000, color: "#2dd4bf", weight: 2, dashArray: "6 8", fillColor: "#2dd4bf", fillOpacity: 0.06 })
      ]).addTo(map);
      var inRadius = data.filter(function (s) { return map.distance([lat, lng], [s.lat, s.lng]) <= 25000; }).length;
      // Zoom into the user's current location (street level). The 25 km circle stays for context when zoomed out.
      map.setView([lat, lng], 15, { animate: true });
      toast(inRadius + " charger" + (inRadius === 1 ? "" : "s") + " within 25 km of you.");
    }, function (err) {
      var msg = "Location unavailable";
      if (err && err.code === 1) msg = "Location blocked — allow location access to use this";
      else if (err && err.code === 3) msg = "Location timed out — try again";
      toast(msg + ".");
    }, { enableHighAccuracy: false, timeout: 12000, maximumAge: 300000 });
  }

  /* ---------- boot ---------- */

  function boot() {
    var lb = byId("locate-btn");
    if (lb) lb.addEventListener("click", locateMe);
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(function () {});
    initMap();
    loadSnapshot(); // instant paint, then async sources replace it
    if (HAS_FEED) {
      loadFeed();
      toast("Live feed configured — connecting to " + CONFIG.liveFeedUrl);
    } else if (HAS_OCM) {
      loadOcm().then(function (n) {
        if (n > 0) toast("OpenChargeMap loaded — " + n + " stations in India (AC + DC).");
      });
    }
    setInterval(refresh, REFRESH_MS);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
