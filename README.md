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
| Page | `index.html` | One full-screen map + a transient error toast. Nothing else |
| Styling | `styles.css` | Map fills the viewport (100dvh), dark popups, theme-matched clusters |
| App logic | `app.js` | Data loading, OCM transform (AC + DC), clustering, popups, auto-refresh |
| Data (bundled) | `data/stations.js` | 1,948 stations (1,525 DC-capable + 423 AC-only) from OpenChargeMap |
| Feed plug point | `config.js` | `ocmApiKey` (OpenChargeMap, free) · `liveFeedUrl` (custom JSON feed) |
| Nginx config | `nginx.conf` | Function Compute static-host contract (listen 9000, root /code) |
| Gap filler | `scripts/update-osm-gaps.js` | Re-checks under-mapped states via Overpass, merges any DC stations found |

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
  map pull fresh OpenChargeMap data every `ocmRefreshMs`; `liveFeedUrl` accepts any custom JSON feed.
- **Data** — `data/stations.js` (regenerate from OCM with `scripts/update-osm-gaps.js` for OSM gaps).
- **Colors** — CSS variables in `styles.css`; cluster colors in the `.marker-cluster-*` rules.
- **Deploy** — zip this folder's *contents* (nginx.conf at zip root) for Function Compute nginx, or push to
  GitHub and link it on Render (Static Site, empty build command, publish directory `.`).

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
