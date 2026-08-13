# India EV Charger Map

Every EV charging station in India — **AC and DC, any connector type** — on one full-screen map.
No filters, no panels, no extra UI. Just the map.

## Run it locally

```bash
# from this folder
python3 -m http.server 8080
# open http://localhost:8080
```

Or double-click `index.html` (the dataset is bundled in `data/stations.js`, so `file://` works).

## How it works

| Piece | File | Role |
|---|---|---|
| Page | `index.html` | One full-screen map + a near-me button + a transient error toast. Nothing else |
| Styling | `styles.css` | Map fills the viewport (100dvh), dark popups, theme-matched clusters |
| App logic | `app.js` | Data loading, OCM transform (AC + DC), clustering, popups, near-me, auto-refresh |
| Data (bundled) | `data/stations.js` | 1,949 stations (1,526 DC-capable + 423 AC-only) from OpenChargeMap |
| Feed plug point | `config.js` | `ocmApiKey` (OpenChargeMap, free) · `liveFeedUrl` (custom JSON feed) |
| PWA | `manifest.webmanifest` + `sw.js` + `icon.svg` | Installable on phones; app shell + data cached for instant/offline boot |
| Nginx config | `nginx.conf` | Function Compute static-host contract (listen 9000, root /code) |
| Data refresh | `scripts/refresh-data.js` | Monthly: re-pull OCM → regenerate snapshot → re-check OSM gaps → auto-commit |
| Gap filler | `scripts/update-osm-gaps.js` | Re-checks under-mapped states via Overpass, merges any DC stations found |

### Features

- **All stations, no filtering** — AC-only, DC fast, ultra-fast, CCS2/CHAdeMO/GBT/Bharat DC; everything with
  valid India coordinates renders. Click a dot for operator, connector counts, status and **when the status was
  last reported** (popup shows "Updated: …").
- **📍 Near me** — the round button (top-right) locates you, draws a 25 km circle and tells you how many chargers
  are inside it. No filtering of the map — just a view.
- **🧭 Distance + navigation** — every popup shows the straight-line distance from your location (after you tap
  📍) and a **Navigate** button that draws the driving route **inside the map** (OSRM, free) with distance, ETA
  and turn-by-turn instructions in a collapsible panel. A **Google Maps** button next to it hands off to voice
  navigation. If routing fails or location is denied, it falls back to Google Maps directions.
- **⚡ Plan EV trip** — the amber button in a popup opens a planner: enter your current battery (SoC %) and the
  car's range on full charge (km). It plans the driving route and suggests **charging stops every ~25% battery**
  (10% reserve), picking real chargers from our dataset near the route. Results: the multi-stop route is drawn on
  the map with turn-by-turn, and each stop shows station, leg distance, and estimated SoC on arrival. A
  "Open route in Google Maps" link hands the full stop-by-stop trip to Google Maps (up to 9 stops). If the
  battery can't reach any charger, it says so honestly.
- **🔍 More stations on Google Maps** — every popup also links to Google Maps' own EV-charger search centered on
  that station, so you can see operator-reported stations we don't have in our data (opens the Google Maps app on
  mobile).
- **PWA** — add it to your home screen: it installs, boots instantly offline (bundled data + app shell cached),
  and opens full-screen standalone. Map tiles themselves still need internet.
- **Auto-fresh data** — a scheduled job re-pulls OpenChargeMap on the 1st of each month, regenerates the
  snapshot, re-checks OSM gap states, and auto-commits (Render redeploys). No manual upkeep.

### Data flow

```
priority: liveFeedUrl  >  ocmApiKey  >  bundled snapshot

liveFeedUrl set? ──yes──▶ fetch(feed) ──▶ normalize ──▶ map
     │ no
ocmApiKey set?  ──yes──▶ fetch OCM API (paginated, India) ──▶ keep valid India coords ──▶ map
     │ no / fetch failure (toast + snapshot fallback)
     ▼
data/stations.js ────────▶ map
     ▼
status-colored dots → clusters at national zoom → individual dots at city level
     ▼
auto-refresh: OCM every ocmRefreshMs (15 min) · feeds every refreshMs (30s default)
```

- **All stations shown, no filtering**: AC-only, DC fast, ultra-fast, CCS2/CHAdeMO/GBT/Bharat DC — everything
  with valid India coordinates renders. Click a dot for a popup with operator, connectors and status.
- Status colors: green = operational, amber = maintenance, red = other (planned/not operational).
- Cluster colors match the dark theme; clusters split at city-level zoom (12+).

## How to change things

- **Live refresh** — `config.js`: `ocmApiKey` (free key from openchargemap.org → profile → My apps) makes the
  map pull fresh OpenChargeMap data every `ocmRefreshMs`; `liveFeedUrl` accepts any custom JSON feed. The key is
  visible in this public repo — that is normal for OCM (free, rate-limited, client-side by design); rotate it at
  openchargemap.org if you ever want to.
- **Data** — `data/stations.js` (regenerate: `node scripts/refresh-data.js`).
- **Colors / button** — CSS variables in `styles.css`; the near-me button is `.locate-btn`.
- **Hosting** — **Render is the primary host** (auto-deploys from GitHub on every push); the Function Compute
  preview is a secondary channel. Both serve the same files.

## Coverage & quality

- Full-screen map on desktop and mobile: `100dvh` height, `invalidateSize()` on resize/orientation (no gray
  tiles), 16px inputs-free (no inputs anymore), safe-area free.
- Clustering keeps 1,948 markers usable at any zoom; popups on tap/click.
- Transient error toast when a live fetch fails (auto-falls back to bundled data); map CDN blocked → message.
- All content in English (the page is a map; strings appear only in popups/toast).

## Honest limitations

OpenChargeMap is community-sourced — the largest open dataset for India but not a complete registry of every
charger, and its "operational" flag is not live operator telemetry. Some states/UTs (Bihar, NE states, Ladakh,
Chandigarh, Andaman, Lakshadweep) have **no stations in any open dataset** — verified against OSM on
2026-08-13 (Bihar: 1 station total, 0 DC; Delhi sanity check: 152). `scripts/update-osm-gaps.js` re-checks
those states and merges anything new. A truly complete national view needs operator OCPI/OCPP integrations or
a government data agreement (e-VAHAAN / MoP).
