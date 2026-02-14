# GeoParquet Viewer — AI Context

## What This Is

A browser-based viewer for [GeoParquet](https://geoparquet.org) files. Users load a `.parquet`/`.geoparquet` file (local or remote URL) and the app visualises it on a map + table — all processing happens client-side via WebAssembly.

Hosted on GitHub Pages. Apache 2.0 license. Author: [moreGeo](https://moregeo.it), funded by OGC.

## Tech Stack

| Layer | Library | Notes |
|-------|---------|-------|
| Framework | Vue 3.5 (Options API) | Single-page app, no router |
| Build | Vite 7 | Code-splitting via `manualChunks` (duckdb, deckgl, maplibre) |
| Data engine | DuckDB-WASM 1.32 | SQL over Parquet, range requests for remote files, spatial extension for `ST_Intersects`/`ST_AsGeoJSON` |
| Map rendering | deck.gl 9.1 GeoJsonLayer | GPU-accelerated, integrated into MapLibre via `@deck.gl/mapbox` `MapboxOverlay` |
| Basemap | MapLibre GL JS 4.7 | OSM raster tiles |
| Styling | SCSS (in SFCs) | Global styles in `App.vue`, scoped in components |

## Architecture

```
src/
  main.js          — Vue app mount (unchanged from scaffold)
  App.vue          — Orchestrator: data loading, state, layout
  db.js            — DuckDB-WASM singleton: init, query, metadata extraction
  wkb.js           — WKB binary → GeoJSON converter (fallback when spatial ext unavailable)
  utils.js         — Small helpers (isObject, etc.)
  components/
    MapView.vue    — MapLibre + deck.gl map, emits select + viewportChange
    TableView.vue  — Virtual-scrolling table (spacer-row technique, ROW_HEIGHT=30)
    FilterPanel.vue — Dynamic column/operator/value filter builder
    LoadingSpinner.vue — Thin animated bar at top of viewport
    modals/
      BaseModal.vue      — Shared modal shell (backdrop, close, submit)
      LoadDataModal.vue  — URL input + file upload + example links
      MetadataModal.vue  — JSON pretty-print or table view
      SchemaModal.vue    — Column table with geo badges + GeoParquet summary
      AboutModal.vue     — Credits
```

### Data Flow

1. User provides URL or local file → `loadData()`
2. DuckDB initialised (singleton, WASM + worker bundled locally — no CDN)
3. Schema, row count, KV metadata, file metadata read via SQL
4. `geo` key from KV metadata parsed → `geoMetadata` (GeoParquet spec)
5. First page queried: `SELECT *, ST_AsGeoJSON(geom) as __geojson FROM read_parquet(...) LIMIT 5000`
6. Arrow rows converted to plain objects (table) + GeoJSON features (map)
7. On map pan/zoom: debounced `viewportChange` → re-query with `ST_Intersects` bbox filter

### Key Design Decisions

- **Self-hosted WASM**: DuckDB WASM + worker files imported with `?url` suffix so Vite copies them to `dist/assets/`. No jsDelivr CDN dependency. Bundle selection uses direct `WebAssembly.Exception` feature detection instead of `duckdb.selectBundle()` (which hangs with local URLs).
- **Spatial extension**: Still fetched at runtime from DuckDB's extension repo. If it fails, the app falls back to client-side WKB parsing (`wkb.js`). The `isSpatialLoaded()` flag controls which code path is used.
- **Viewport-driven filtering**: Only activated when the GeoParquet `geo` metadata has `covering.bbox` on the primary geometry column (per the GeoParquet spec). When enabled and the spatial extension is loaded, queries include `ST_Intersects(geo_col, ST_MakeEnvelope(...))`. This leverages GeoParquet bbox covering columns for predicate pushdown. Without coverings, spatial filtering would require a full scan and is skipped. Generation counter discards stale results during rapid panning.
- **Geometry column detection**: Primary source is `geoMetadata.primary_column`. Fallback: schema-based detection matching known column names (`geometry`, `geom`, `wkb_geometry`, `the_geom`, `shape`) or types (`GEOMETRY`, `BLOB`).
- **CRS reprojection**: Reads `crs` from GeoParquet `columns.<name>.crs` PROJJSON. Per the spec, absent/null CRS means WGS 84. If the EPSG code is not 4326, geometries are reprojected at query time via `ST_Transform(ST_GeomFromWKB(geom), '<PROJJSON>', 'EPSG:4326', true)`. The full PROJJSON from GeoParquet metadata is passed directly to `ST_Transform` instead of EPSG codes, because DuckDB-WASM's spatial extension doesn't bundle the PROJ database needed for arbitrary EPSG lookups (crashes with `_setThrew is not defined`). PROJ can parse PROJJSON natively. `ST_GeomFromWKB()` is required because `read_parquet()` returns geometry as WKB BLOB, not GEOMETRY type. Viewport bbox filters are also transformed to the source CRS. When CRS is projected, metadata bbox (in source CRS units) is skipped and bounds are computed from features instead. WKB fallback (no spatial extension) only works for WGS 84 data — non-4326 CRS requires the spatial extension for `ST_Transform`.
- **KV metadata BLOB decoding**: DuckDB's `parquet_kv_metadata` returns both key and value as BLOB (Uint8Array). Must decode with `TextDecoder`, not `String()`.
- **Virtual scrolling**: TableView uses spacer rows (not `transform`), `ROW_HEIGHT=30`, `BUFFER_ROWS=20`, `ResizeObserver` for container measurement.
- **No COOP/COEP headers**: They block cross-origin OSM tiles and DuckDB CDN resources. DuckDB-WASM falls back to single-threaded mode without `SharedArrayBuffer`.

## Common Pitfalls

- `duckdb.selectBundle()` can hang with self-hosted URLs → use direct feature detection
- `parquet_kv_metadata` keys are BLOB, not VARCHAR → use `TextDecoder`
- `ResizeObserver.observe()` on a `v-else`-hidden ref → guard with `if (this.$refs.scroller)`
- Vue Options API: data properties starting with `_` are reserved → use plain names
- MapboxOverlay may not repaint after `setProps` → call `map.triggerRepaint()`
- `db.open({ query: { castBigIntToDouble: true } })` may not work in all versions → wrap in try/catch with fallback
- `ST_Transform` with EPSG codes (e.g. `'EPSG:32648'`) crashes DuckDB-WASM with `_setThrew is not defined` → pass full PROJJSON string from GeoParquet metadata instead
- `read_parquet()` returns geometry as WKB BLOB, not GEOMETRY type → wrap with `ST_GeomFromWKB()` before `ST_Transform`

## Build & Run

```sh
npm install
npm run dev      # http://localhost:5173
npm run build    # production build → dist/
npm run lint     # ESLint
```

Build produces ~1.9 MB JS (4 chunks) + ~73 MB WASM (both EH and MVP variants; only one downloaded per session).

## URL Parameters

- `?url=<encoded-parquet-url>` — auto-load a remote file on page open
