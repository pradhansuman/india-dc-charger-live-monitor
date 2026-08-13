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
      var gv = el.querySelector(".nav-btn-google");
      if (gv && !isNaN(lat) && !isNaN(lng)) {
        gv.href = gmapFallbackUrl(lat, lng);
      }
      var pv = el.querySelector(".nav-btn-plan");
      if (pv && box && !isNaN(lat) && !isNaN(lng)) {
        pv.addEventListener("click", function () {
          map.closePopup();
          openTripPanel(lat, lng, box.getAttribute("data-name") || "");
        });
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
        "<div class='pop-data' data-lat='" + s.lat + "' data-lng='" + s.lng + "' data-name='" + esc(s.name) + "'>" +
        "<div class='pop-nav'><span class='dist-label'>Distance</span><b class='dist-val'>—</b>" +
        "<a class='nav-btn nav-btn-google' href='#' target='_blank' rel='noopener'>Google Maps</a>" +
        "<button type='button' class='nav-btn nav-btn-plan'>⚡ Plan trip</button></div>" +
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
  var userIconCached = null;
  var routeControl = null;

  // Red car marker for the user's location (inline SVG — no external image dependency).
  function userIcon() {
    if (userIconCached) return userIconCached;
    userIconCached = L.divIcon({
      html: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="30" height="30" style="filter:drop-shadow(0 1px 2px rgba(0,0,0,.45))">' +
        '<path d="M8 40 h48 v6 a4 4 0 0 1 -4 4 h-40 a4 4 0 0 1 -4 -4 z" fill="#e74c3c"/>' +
        '<path d="M20 40 v-7 a5 5 0 0 1 5 -5 h12 l7 12 z" fill="#e74c3c"/>' +
        '<path d="M22 40 v-6 h9 l6 6 z" fill="#d7ecf7"/>' +
        '<circle cx="20" cy="48" r="6" fill="#1f2933"/>' +
        '<circle cx="44" cy="48" r="6" fill="#1f2933"/>' +
        '<circle cx="20" cy="48" r="2.4" fill="#cbd2d9"/>' +
        '<circle cx="44" cy="48" r="2.4" fill="#cbd2d9"/>' +
        '<circle cx="54.5" cy="42.5" r="1.7" fill="#ffe08a"/>' +
        '</svg>',
      className: "",
      iconSize: [30, 30],
      iconAnchor: [15, 25]
    });
    return userIconCached;
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
        L.marker([lat, lng], { icon: userIcon(), zIndexOffset: 1000 }),
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

  /* ---------- Google Maps fallback link ---------- */

  function gmapFallbackUrl(lat, lng) {
    var dest = encodeURIComponent(lat + "," + lng);
    var origin = userPos ? "origin=" + encodeURIComponent(userPos.lat + "," + userPos.lng) + "&" : "";
    return "https://www.google.com/maps/dir/?api=1&" + origin + "destination=" + dest + "&travelmode=driving";
  }

  /* ---------- EV trip planner (range-aware charging stops) ---------- */

  var tripDest = null;

  function haversineKm(a, b) {
    var R = 6371, dLat = (b.lat - a.lat) * Math.PI / 180, dLng = (b.lng - a.lng) * Math.PI / 180;
    var s = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(a.lat * Math.PI / 180) * Math.cos(b.lat * Math.PI / 180) *
      Math.sin(dLng / 2) * Math.sin(dLng / 2);
    return 2 * R * Math.asin(Math.sqrt(s));
  }

  function cumulativeKm(coords) {
    var cum = [0], i;
    for (i = 1; i < coords.length; i++) cum.push(cum[i - 1] + haversineKm(coords[i - 1], coords[i]));
    return cum;
  }

  function routeIndexAt(cum, km) {
    var lo = 0, hi = cum.length - 1, mid;
    while (lo < hi) { mid = (lo + hi) >> 1; if (cum[mid] < km) lo = mid + 1; else hi = mid; }
    return lo;
  }

  function findStationNear(pt, stations, used, maxKm) {
    var best = null, bestD = maxKm + 1, i, d;
    for (i = 0; i < stations.length; i++) {
      if (used.has(i)) continue;
      d = haversineKm(pt, stations[i]);
      if (d < bestD) { bestD = d; best = i; }
    }
    return bestD <= maxKm ? { index: best, station: stations[best], distKm: bestD } : null;
  }

  function findChargingStops(coords, opts, stations) {
    var fullRange = Math.max(20, Math.min(2000, opts.fullRangeKm || 400));
    var startSoc = Math.max(5, Math.min(100, opts.startSoc || 80));
    var legKm = fullRange * 0.8;                  // drive until battery hits ~20%
    var firstLegKm = fullRange * (startSoc - 20) / 100; // first leg from current SoC, arrive at 20%
    var cum = cumulativeKm(coords);
    var totalKm = cum[cum.length - 1];
    var usableKm = firstLegKm;
    var result = { stops: [], totalKm: totalKm, usableKm: usableKm, direct: totalKm <= usableKm };
    if (usableKm <= 0) { result.error = "Not enough battery to reach any charger (battery drops below 20% almost immediately)."; return result; }
    if (result.direct) return result;
    var used = new Set(), curIdx = 0, prevKm = 0, guard = 0, radii = [4, 8, 15, 30, 50];
    while (guard++ < 25) {
      var isFirst = curIdx === 0;
      var allowed = isFirst ? firstLegKm : legKm;
      var remaining = totalKm - cum[curIdx];
      if (remaining <= allowed) break;            // can reach destination from here
      var step = Math.min(allowed, remaining - 0.5);
      if (step < 20) {
        result.error = "Not enough range to reach the next charger — charge more before leaving or pick a closer destination.";
        result.stops = [];
        return result;
      }
      var tIdx = routeIndexAt(cum, cum[curIdx] + step);
      var pt = coords[tIdx], found = null, r;
      for (r = 0; r < radii.length && !found; r++) found = findStationNear(pt, stations, used, radii[r]);
      var kmFromOrigin = cum[tIdx];
      var legDist = kmFromOrigin - prevKm;
      var leaveSoc = isFirst ? startSoc : Math.max(startSoc, 80); // assume you charge to at least 80% at stops
      var socAt = Math.max(0, Math.round(leaveSoc - legDist / fullRange * 100));
      if (found) {
        used.add(found.index);
        result.stops.push({ station: found.station, distKm: found.distKm, kmFromOrigin: kmFromOrigin, legDist: legDist, socAtArrival: socAt, note: found.distKm > 15 ? "long gap — charge as much as possible" : "" });
      } else {
        result.stops.push({ station: null, kmFromOrigin: kmFromOrigin, legDist: legDist, socAtArrival: socAt, note: "no charger within 50 km — charge longer at the previous stop" });
      }
      prevKm = kmFromOrigin;
      curIdx = tIdx;
    }
    return result;
  }

  function openTripPanel(lat, lng, name) {
    tripDest = { lat: lat, lng: lng };
    byId("trip-dest").textContent = "To: " + (name || "Selected charger");
    byId("trip-stops").innerHTML = "";
    byId("trip-gmaps").innerHTML = "";
    byId("trip-panel").hidden = false;
  }

  function closeTripPanel() { byId("trip-panel").hidden = true; }

  function gmapsWithStopsUrl(origin, dest, plan) {
    var stops = plan.stops.filter(function (s) { return s.station; }).slice(0, 9);
    var wp = stops.map(function (s) { return s.station.lat + "," + s.station.lng; }).join("|");
    return "https://www.google.com/maps/dir/?api=1&origin=" + encodeURIComponent(origin.lat + "," + origin.lng) +
      (wp ? "&waypoints=" + encodeURIComponent(wp) : "") +
      "&destination=" + encodeURIComponent(dest.lat + "," + dest.lng) + "&travelmode=driving";
  }

  function renderTripResult(origin, dest, plan) {
    var waypoints = [L.latLng(origin.lat, origin.lng)];
    plan.stops.forEach(function (s) { if (s.station) waypoints.push(L.latLng(s.station.lat, s.station.lng)); });
    waypoints.push(L.latLng(dest.lat, dest.lng));
    if (routeControl) map.removeControl(routeControl);
    routeControl = L.Routing.control({
      waypoints: waypoints,
      router: L.Routing.osrmv1({ serviceUrl: "https://router.project-osrm.org/route/v1" }),
      routeWhileDragging: false,
      showAlternatives: false,
      fitSelectedRoutes: true,
      collapsible: true,
      show: true
    }).addTo(map);
    // Keep the instruction panel out of the way on phones — start it collapsed.
    if (window.innerWidth < 768 && routeControl.collapse) routeControl.collapse();
    routeControl.on("routingerror", function () { toast("Multi-stop routing failed — open the Google Maps link instead."); });

    var html = "";
    if (plan.error) {
      html = "<div class='trip-err'>" + esc(plan.error) + "</div>";
    } else if (plan.direct) {
      html = "<div class='trip-ok'>No charging stops needed — your range covers the trip (" + Math.round(plan.usableKm) + " km usable vs " + Math.round(plan.totalKm) + " km trip).</div>";
    } else {
      html = "<div class='trip-ok'>" + plan.stops.length + " charging stop" + (plan.stops.length === 1 ? "" : "s") + " suggested (battery kept above ~20%).</div>";
      plan.stops.forEach(function (s, i) {
        if (!s.station) {
          html += "<div class='trip-stop trip-stop-warn'><b>Stop " + (i + 1) + "</b> — " + esc(s.note) + " (at " + Math.round(s.kmFromOrigin) + " km)</div>";
          return;
        }
        html += "<div class='trip-stop'><b>Stop " + (i + 1) + ": " + esc(s.station.name) + "</b> · " + esc(s.station.operator) +
          "<br><span>at " + Math.round(s.kmFromOrigin) + " km · arrive ~" + s.socAtArrival + "% SoC · " + (s.station.dcFast + s.station.ultra) + " DC</span>" +
          (s.note ? " <em>" + esc(s.note) + "</em>" : "") + "</div>";
      });
    }
    byId("trip-stops").innerHTML = html;
    byId("trip-gmaps").innerHTML =
      "<a class='trip-gmap-link' href='" + (plan.stops.length ? gmapsWithStopsUrl(origin, dest, plan) : gmapFallbackUrl(dest.lat, dest.lng)) + "' target='_blank' rel='noopener'>Open route in Google Maps</a>";
  }

  function planTrip() {
    if (!tripDest) { toast("Pick a destination charger first."); return; }
    var soc = parseFloat(byId("trip-soc").value);
    var fullRange = parseFloat(byId("trip-range").value);
    if (isNaN(soc) || isNaN(fullRange)) { toast("Enter your battery % and range."); return; }
    soc = Math.max(5, Math.min(100, soc));
    fullRange = Math.max(20, Math.min(2000, fullRange));
    var dest = tripDest;
    var runPlan = function (origin) {
      var url = "https://router.project-osrm.org/route/v1/driving/" + origin.lng + "," + origin.lat + ";" + dest.lng + "," + dest.lat + "?overview=full&geometries=geojson&steps=false";
      toast("Planning route with charging stops…");
      fetch(url, { cache: "no-store" })
        .then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
        .then(function (res) {
          var route = res.routes && res.routes[0];
          if (!route || !route.geometry || !route.geometry.coordinates || !route.geometry.coordinates.length) throw new Error("no route");
          var coords = route.geometry.coordinates.map(function (c) { return { lat: c[1], lng: c[0] }; });
          var plan = findChargingStops(coords, { fullRangeKm: fullRange, startSoc: soc }, data);
          renderTripResult(origin, dest, plan);
        })
        .catch(function (err) {
          toast("Route planning failed (" + err.message + ") — open Google Maps instead.");
          window.open(gmapFallbackUrl(dest.lat, dest.lng), "_blank");
        });
    };
    if (userPos) { runPlan(userPos); return; }
    toast("Locating you…");
    navigator.geolocation.getCurrentPosition(function (pos) {
      userPos = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      runPlan(userPos);
    }, function () { toast("Location unavailable — can't plan a trip."); }, { enableHighAccuracy: false, timeout: 12000, maximumAge: 300000 });
  }

  /* ---------- boot ---------- */

  function boot() {
    var lb = byId("locate-btn");
    if (lb) lb.addEventListener("click", locateMe);
    var tc = byId("trip-close");
    if (tc) tc.addEventListener("click", closeTripPanel);
    var tp = byId("trip-plan");
    if (tp) tp.addEventListener("click", planTrip);
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
