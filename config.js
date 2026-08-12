// ============================================================
// Live data configuration — the plug points for real feeds
// ============================================================
// Priority when more than one is set:  liveFeedUrl > ocmApiKey > bundled snapshot.
//
// 1) OpenChargeMap (recommended, free)
//    - Get a free API key: sign in at https://openchargemap.org →
//      profile menu → "my apps" → Register An Application.
//    - Set ocmApiKey below. The page then fetches every India POI
//      from the OCM API in the browser (CORS is open) and shows the
//      DC-capable ones on the map with an "OCM LIVE" badge.
//    - Community data: stations are user-submitted, so coverage is
//      good but not guaranteed complete. Auto-refreshes every
//      ocmRefreshMs to respect free-key rate limits.
//
// 2) Custom JSON feed
//    - liveFeedUrl can be any endpoint returning a JSON array of
//      station objects in this shape:
//      [{ "name": "...", "operator": "...", "state": "...",
//         "city": "...", "lat": 28.6, "lng": 77.2,
//         "dcFast": 3, "ultra": 1, "ccs2": 3, "chademo": 1,
//         "gbt": 0, "bharatDC": 0, "power": "50, 150",
//         "is24x7": true, "status": "operational",
//         "ts": 1783514555128 }]
//
// 3) Snapshot fallback
//    - With both unset, the page serves data/stations.js
//      (bundled dataset) in SNAPSHOT mode.
window.APP_CONFIG = {
  liveFeedUrl: null,          // custom JSON feed URL (optional)
  apiKey: null,               // sent as X-API-Key header for liveFeedUrl
  ocmApiKey: "df1c59d4-9171-459d-bb1a-580183889105", // OpenChargeMap free key
  ocmRefreshMs: 900000,       // OCM poll interval (15 min, rate-limit friendly)
  refreshMs: 30000            // custom-feed poll interval (ms)
};
