# India DC Charger Live Monitor

View-only live monitor of DC fast & ultra-fast charging stations across India:
interactive map, station list, status pills, KPIs, filters and auto-refresh.

## Run it locally

No build step, no dependencies to install — pure static files.

```bash
# from this folder
python3 -m http.server 8080
# open http://localhost:8080
```

Or just double-click `index.html` — it works from `file://` too (the dataset is
bundled in `data/stations.js`).

## How it works

| Piece | File | Role |
|---|---|---|
| Page | `index.html` | Layout: header + live badge, KPIs, filters, map, table |
| Styling | `styles.css` | Dark mission-control theme, responsive, focus states |
| App logic | `app.js` | Filter/sort/render, Leaflet map, auto-refresh timer, feed fallback |
| Data (bundled) | `data/stations.js` | 1,526 DC-capable stations from OpenChargeMap (India), normalized |
| Feed plug point | `config.js` | `ocmApiKey` (OpenChargeMap, free) · `liveFeedUrl` (custom JSON feed) · refresh intervals |
| Nginx config | `nginx.conf` | Function Compute static-host contract (listen 9000, root /code) |

### Data flow

```
priority: liveFeedUrl  >  ocmApiKey  >  bundled snapshot

liveFeedUrl set? ──yes──▶ fetch(feed) ──▶ normalize ──▶ render (LIVE FEED badge)
     │ no                                                          │
ocmApiKey set?  ──yes──▶ fetch OCM API (paginated, India) ──▶ keep DC (Level 3) ──▶ render (OCM LIVE badge)
     │ no / fetch failure (toast + snapshot fallback)              │
     ▼                                                             ▼
data/stations.js (window.DC_STATIONS) ────────▶ render (SNAPSHOT badge)
        ▼
filters (search / state / operator / status) → sort → KPI + table + map
        ▼
auto-refresh: OCM every ocmRefreshMs (15 min) · feeds every refreshMs (30s default)
```

### Status mapping

`operational` → Online (green) · `under_maintenance` → Maintenance (amber) ·
everything else (`power_failure`, `communication_failure`, `temporarily_unavailable`,
`permanently_closed`) → Offline (red).

## How to change things

- **Show OpenChargeMap data (free, recommended)** — get a free API key at
  https://openchargemap.org (sign in → profile → "my apps" → Register An
  Application), then set `ocmApiKey` in `config.js`. The page fetches every
  India POI from the OCM API in the browser (CORS is open) on load and then
  every `ocmRefreshMs` (default 15 min, rate-limit friendly), keeps only
  DC-capable stations (Level 3 connections), and shows them with an
  **OCM LIVE** badge. Community data: coverage is good but not guaranteed
  complete, and "operational" comes from OCM's status field, not live
  operator telemetry.
- **Go live with a custom feed** — edit `config.js`: set `liveFeedUrl` to an
  endpoint returning a JSON array of station objects (shape documented in that
  file). Set `refreshMs` for poll frequency, `apiKey` if the feed needs one.
  Priority when several are configured: `liveFeedUrl` > `ocmApiKey` > snapshot.
- **Add/remove stations in snapshot** — edit `data/stations.js` (array items
  follow the same shape).
- **Colors** — CSS variables at the top of `styles.css` (`--online`,
  `--maint`, `--offline`, `--accent`).
- **Filter options / table columns** — in `app.js`: `populateFilters()` and the
  `<th data-key>` rows in `index.html`.
- **Refresh interval** — `config.js` (`ocmRefreshMs` for OCM,
  `refreshMs` for custom feeds; also shown in the footer).
- **Deploy** — zip this folder's *contents* (nginx.conf at zip root) for the
  Function Compute nginx environment.

## Coverage & quality

- Desktop + mobile responsive (map/table stack below 980px; controls stack below 560px).
- **Map clustering**: dense areas (e.g. Kerala, Karnataka) group into numbered clusters at low zoom
  (Leaflet.markercluster, theme-matched colors) and split into individual dots at city level — click a
  cluster to zoom in. Falls back to plain markers if the CDN is blocked.
- **Clean state dropdown**: OpenChargeMap state strings are normalized (trim, case, typos like
  "Karnatak"/"Lerala"/"Tamil Nasdu", abbreviations like GJ/MH/MP/RJ, districts like "Villupuram" →
  Tamil Nadu) — the filter lists each state exactly once, both for the bundled snapshot and live
  OCM fetches.
- Loading state: initial render from snapshot is instant; live mode shows a toast while connecting.
- Empty state: "No DC chargers match your filters" when a filter clears the list.
- Error state: failed live fetch → toast + automatic fallback to snapshot data.
- Status filters: All / Online / Maintenance / Offline; legend on the list panel.
- Interactive states: hover on rows, sortable column headers, focus rings on inputs/buttons/rows, keyboard reachable (Enter/Space on a row focuses the map marker).
- Map requires internet (Leaflet CDN + OpenStreetMap tiles); the list works offline and a notice explains when tiles can't load.

## Honest limitations

OpenChargeMap is community-sourced: stations are submitted and edited by
volunteers and businesses, so it is the largest open dataset but **not a
complete registry of every DC charger in India**, and its "operational" flag
is not live operator telemetry. A complete national real-time view would need
operator partnerships (OCPI/OCPP integrations) or a government data agreement
(e-VAHAAN / MoP) — until then "all chargers, real-time" is a data problem, not
a frontend problem. The page shows exactly which source it is using (OCM LIVE /
LIVE FEED / SNAPSHOT badge) and falls back gracefully when a fetch fails.
