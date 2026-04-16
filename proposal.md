# GeoParquet Viewer — Project Architecture & Decision Log

## 1. Project Goal

A purely client-side, browser-based GeoParquet viewer. Users can load GeoParquet files from a local filesystem or a public URL, explore the data in a table, visualize geometries on an interactive map, and inspect full Parquet/GeoParquet metadata — all without leaving the browser.

---

## 2. Feature Requirements

| #  | Feature                                                                                     | Priority     |
|----|---------------------------------------------------------------------------------------------|--------------|
| 1  | Load files from local filesystem or publicly hosted URLs                                    | Must         |
| 2  | Map visualization of any geometry type (Point, Line, Polygon, Multi*)                       | Must         |
| 3  | Table visualization of non-geometry columns                                                 | Must         |
| 4  | Full Parquet metadata display: KVP metadata, schema, column types, compression              | Must         |
| 5  | GeoParquet 1.0 support; 1.1 and 2.0 as bonus                                                | Must / Bonus |
| 6  | Bidirectional selection: table row ↔ map geometry                                           | Must         |
| 7  | Row-group based loading — initial page of 1000 rows, Load More / Load All on demand         | Must         |
| 8  | Any-CRS support — render data in its native projection with a correctly reprojected basemap | Must         |
| 9  | Basic filtering: bbox spatial filter + attribute filters (number comparisons, string match) | Must         |
| 10 | GitHub hosting (code + deployment), open-source licensed                                    | Must         |

---

## 3. Where We Started — Original Implementation

The initial implementation was a working Vue 3 (Options API) application with the following stack:

| Layer            | Library                                            | Notes                                      |
|------------------|----------------------------------------------------|--------------------------------------------|
| Parquet parsing  | `hyparquet` + `hyparquet-compressors` + `hysnappy` | JS-only, runs on main thread               |
| Map renderer     | OpenLayers (`ol`)                                  | SVG/Canvas, CPU-based rendering            |
| Base map tiles   | OL OSM TileLayer                                   |                                            |
| Geometry parsing | OL `WKB` format reader                             | WKB → OL Feature objects                   |
| Reprojection     | `proj4js` + OL proj4 register                      | Fetched WKT defs from spatialreference.org |
| State            | Vue Options API `data()` in `App.vue`              | Monolithic — all logic in one file         |
| Pagination       | hyparquet `onChunk` row-group streaming            | 100 rows per page                          |

### What worked well

- hyparquet's `asyncBuffer` pattern (HTTP Range requests) was elegant for streaming
- OpenLayers' native any-CRS tile reprojection worked correctly out of the box

### Pain points that drove the migration

- **Main-thread blocking** — hyparquet runs synchronously on the main thread; large files freeze the UI
- **No SQL layer** — filtering required manual JS array operations; no aggregation capability
- **OL rendering performance** — OpenLayers' Canvas/SVG renderer struggles beyond ~50k features; large polygon datasets are slow
- **No GeoArrow support** — hyparquet returns plain JS arrays, not columnar Arrow data; no path to GPU-accelerated columnar rendering

---

## 4. Explored Options & Why They Were Discarded

### 4.1 Option A: DuckDB-Wasm → GeoJSON → deck.gl + MapLibre GL

**Description:** Replace hyparquet with DuckDB-Wasm for all Parquet reading and SQL. DuckDB's spatial extension outputs `ST_AsGeoJSON()` directly. deck.gl renders GeoJSON features. MapLibre GL provides the basemap.

**Why it was scrapped:**

- **GeoJSON serialization overhead.** DuckDB serializes geometry to GeoJSON text strings; deck.gl then parses them back into typed arrays. For 100k+ features this is a significant, avoidable round-trip.
- **No CRS solution.** MapLibre GL's basemap tiles are locked to Web Mercator (EPSG:3857). For data in any other CRS (e.g. EPSG:25832, EPSG:4258), the basemap would be geometrically misaligned with the data unless the data was first reprojected to EPSG:4326. MapLibre's built-in projection support only covers a small set of named projections and cannot handle arbitrary EPSG codes. This made it impossible to meet feature requirement #8 without a separate reprojection step that negated the simplicity of this approach.
- **Missed GeoArrow opportunity.** Passing GeoJSON to deck.gl bypasses the high-performance GeoArrow columnar path that deck.gl 9.x supports natively, leaving rendering performance gains on the table.

---

### 4.2 Option B: MapLibre GL alone (no deck.gl)

**Description:** Use MapLibre GL as the sole map renderer, feeding it GeoJSON or vector tiles. Remove deck.gl entirely.

**Why it was scrapped:**

- **GeoJSON only path.** MapLibre's data sources accept GeoJSON or vector tiles (MVT). For large GeoParquet files, converting everything to GeoJSON in the browser is memory-intensive and slow. There is no native GeoArrow or WKB ingestion path in MapLibre.
- **No columnar rendering.** MapLibre renders via its own internal symbol/fill/line layers which are not designed for dynamic, row-level selection highlighting or per-feature custom styling at scale. deck.gl's `GeoJsonLayer` with `pickable: true` handles this far more efficiently via GPU picking.
- **Same CRS problem as Option A.** MapLibre's tile system is Mercator-only without per-tile warping. The arbitrary CRS requirement cannot be met cleanly.
- **Vector tile generation is server-side work.** Converting GeoParquet → MVT requires a tile server or pre-processing pipeline, which violates the client-only constraint.

---

### 4.3 Option C: DuckDB-Wasm → GeoArrow → deck.gl + MapLibre (vector data reprojected to WGS84)

**Description:** The most fully designed option before the final decision. DuckDB handles all SQL including `ST_Transform` to reproject data to EPSG:4326. Geometry flows as WKB from DuckDB → parsed to GeoArrow columnar format → deck.gl `GeoJsonLayer`. MapLibre GL provides a standard Mercator basemap. proj4js kept as fallback for CRS DuckDB can't resolve.

**Why it was scrapped:**

- **Reprojection destroys the native CRS experience.** Feature requirement #8 explicitly asks to render data in its native projection. Always converting everything to EPSG:4326 means the basemap is always Web Mercator and the data loses its native coordinate frame. For datasets authored in national grid systems (e.g. ETRS89 / EPSG:25832 in Germany, OSGB36 in the UK), this is a meaningful loss of fidelity for GIS users.
- **MapLibre cannot reproject its own basemap tiles** to arbitrary CRS. Even if deck.gl rendered the geometry correctly in a non-Mercator space, the MapLibre tile layer underneath would be geometrically wrong. This was a hard blocker.
- **The GeoArrow pipeline is preserved** in the final architecture, so the performance advantage of this option is not lost — only the MapLibre basemap is replaced.

---

## 5. Chosen Architecture

**DuckDB-Wasm (data + SQL) + OpenLayers (basemap, any-CRS tile reprojection) + deck.gl (GPU geometry rendering as OL overlay)**

This hybrid combines:

- **DuckDB-Wasm** for all Parquet reading, metadata extraction, SQL filtering, pagination, and geometry encoding detection.
- **OpenLayers** for basemap tile management and native any-CRS tile reprojection. OL has first-class proj4js integration and can reproject OSM/WMTS tiles to any registered EPSG code client-side. This is exactly what it was built for.
- **deck.gl** (`ol-deck` / `@deck.gl/core` with an OL-compatible canvas overlay) for WebGL2 GPU-accelerated rendering of GeoArrow geometry. deck.gl handles large feature counts, per-feature picking, and custom styling that OL's Canvas renderer cannot match at scale.
- **proj4js** for CRS definition loading. Definitions are read from the GeoParquet file's `geo` metadata when available, to enable OpenLayers' basemap tile reprojection to any registered EPSG code.

### Why this combination wins

| Requirement                | Solution                                                                          |
|----------------------------|-----------------------------------------------------------------------------------|
| Any-CRS basemap            | OpenLayers natively reprojects OSM tiles to any proj4-registered CRS              |
| Large dataset rendering    | deck.gl WebGL2 BinaryGeometryLayer with GeoArrow columnar format — GPU instancing |
| Native GeoArrow path       | deck.gl 9.x accepts GeoArrow Tables directly (zero-copy)                          |
| WKB/WKT support            | Parsed to GeoArrow columnar format in browser, unified rendering                  |
| SQL filtering & pagination | DuckDB-Wasm — main thread never blocked                                           |
| All geometry encodings     | DuckDB spatial reads WKB; GeoArrow passed through; WKT normalised to WKB          |
| Local + remote files       | DuckDB `registerFileBuffer` (local) + `httpfs` (URL)                              |
| Metadata-first UX          | DuckDB `parquet_schema()` + KVP metadata read before any row data                 |

---

## 6. System Design

### 6.1 Data Flow Pipeline

```
┌─────────────────────────────────────────────────────────────────┐
│  USER ACTION: Load file (URL or local File object)              │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│  STEP 1 —                                                       │
│                                                                 │
│  • registerFileBuffer(file) OR register httpfs URL              │
│  • LOAD spatial; LOAD httpfs;                                   │
│  • SELECT * FROM parquet_schema(file)  → column names + types   │
│  • SELECT value FROM parquet_kv_metadata(file)                  │
│    WHERE key = 'geo'          → raw GeoParquet JSON metadata    │
│  • SELECT compression, num_rows, row_groups                     │
│    FROM parquet_metadata(file) → file-level stats               │
│  • COUNT(*) query             → totalNumRows                    │
└────────────────────────────┬────────────────────────────────────┘
                             │  raw metadata → useFileStore
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│  STEP 2 —                                                       │
│                                                                 │
│  Parse 'geo' KVP JSON:                                          │
│  • primary_column name                                          │
│  • geometry encoding: "WKB" | "geoarrow.*" | "WKT"              │
│  • CRS: authority + code (e.g. EPSG:25832)                      │
│  • bbox (native CRS coordinates)                                │
│  • geometry_types[]                                             │
└────────────────────────────┬────────────────────────────────────┘
                             │  parsed geoMetadata → useGeoStore
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│  STEP 3 — MetadataModal auto-shown to user                      │
│                                                                 │
│  Displays:                                                      │
│  • Full parquet schema (column name, type, compression)         │
│  • GeoParquet metadata (CRS, geometry type, encoding, bbox)     │
│  • KVP metadata (all key-value pairs)                           │
│  • Checkboxes: user selects which non-geo columns to load       │
│  • [Submit] triggers data fetch                                 │
└────────────────────────────┬────────────────────────────────────┘
                             │  selectedColumns[] → useQueryStore
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│  STEP 4 —                                                       │
│                                                                 │
│  Encoding-aware query:                                          │
│                                                                 │
│  IF encoding == "WKB":                                          │
│    SELECT <selectedCols>, "<geomCol>" AS __geom_raw             │
│    FROM read_parquet(file)                                      │
│    WHERE <filters>                                              │
│    LIMIT 1000 OFFSET {offset}                                   │
│                                                                 │
│  IF encoding == "geoarrow.*":                                   │
│    SELECT <selectedCols>, "<geomCol>"                           │
│    → pass Arrow column directly (no conversion needed)          │
│                                                                 │
│  IF encoding == "WKT":                                          │
│    SELECT <selectedCols>,                                       │
│           ST_AsWKB(ST_GeomFromText("<geomCol>")) AS __geom_raw  │
│    → normalise to WKB for unified downstream parsing            │
│                                                                 │
│  Returns: Apache Arrow Table via queryArrow() IPC stream        │
└────────────────────────────┬────────────────────────────────────┘
                             │  Arrow Table (columnar binary)
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│  STEP 5 —                                                       │
│                                                                 │
│  IF encoding == "geoarrow.*":                                   │
│    → pass Arrow geometry column directly to GeoArrow format     │
│      (zero-copy, native columnar path)                          │
│                                                                 │
│  IF encoding == "WKB":                                          │
│    → parse each WKB Uint8Array to coordinates + geometry type   │
│    → construct GeoArrow columnar arrays (offset arrays, coords) │
│    → build Arrow Table with geometry column in GeoArrow format  │
│                                                                 │
│  IF encoding == "WKT":                                          │
│    → DuckDB normalises to WKB via ST_AsWKB(ST_GeomFromText())   │
│    → follow same path as WKB above                              │
│                                                                 │
│  All coordinates remain in native CRS — no reprojection applied │
│  Output: Apache Arrow Table with GeoArrow geometry column       │
└────────────────────────────┬────────────────────────────────────┘
                             │  Apache Arrow Table (GeoArrow geometry)
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│  STEP 6 —                                                       │
│                                                                 │
│  For all encoding paths (geoarrow.*, WKB, WKT):                 │
│    Use @geoarrow/deck.gl-layers BinaryGeometryLayer:            │
│      data: Arrow Table with GeoArrow geometry column            │
│      pickable: true                                             │
│      getFillColor/getLineColor: selection-based                 │
│      onClick: (info) → useSelectionStore.select(info.index)     │
│                                                                 │
│  Unified rendering path — no GeoJsonLayer needed                │
│  Mounted as OL CanvasLayer overlay on OpenLayers map            │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│  STEP 7 —                                                       │
│                                                                 │
│  OpenLayers Map:                                                │
│  • TileLayer(OSM) → reprojected to data's native CRS            │
│  • proj4js CRS definition: read from file geo metadata first,   │
│    fallback to epsg.io if not embedded                          │
│  • ol.proj.register(proj4) to register custom CRS               │
│  • View set to detected CRS from geoMetadata                    │
│  • Fit view to geometry bbox on first load                      │
│  • deck.gl canvas overlaid via custom OL layer                  │
└─────────────────────────────────────────────────────────────────┘
```

---

### 6.3 CRS & Projection Strategy

This is the most architecturally significant decision in the project.

**The problem:** GeoParquet files can be authored in any CRS. Displaying them correctly requires the base-map tiles to be visually aligned with the geometry data.

**The solution: Reproject basemap only, keep data native**

OpenLayers has first-class support for arbitrary CRS via its proj4js integration. When a projection is registered with `ol.proj.register(proj4)`, OL's tile reprojection engine automatically warps incoming Mercator (EPSG:3857) OSM tiles into the target CRS on the fly, tile by tile, using bilinear resampling. The geometry data is kept in its native CRS without coordinate transformation — only the basemap is reprojected to match.

**CRS definition priority:**

1. If the GeoParquet file's `geo` metadata contains a full WKT or PROJJSON CRS definition, extract it directly (no network request)
2. Otherwise, fetch the definition from epsg.io as a fallback
3. Register with proj4js and apply to OpenLayers' tile reprojection

```
Detection flow:
─────────────────────────────────────────────────────
1. Parse 'geo' metadata → extract CRS authority:code
2. If code is EPSG:4326 or EPSG:3857 (default/compatible):
   → no reprojection needed, use default basemap
3. Otherwise (non-standard CRS):
   a. Check if 'crs' field in geo metadata contains WKT or PROJJSON
   b. If yes:
      - Extract CRS definition directly from the file
      - proj4.defs('EPSG:{code}', wktDefinition)
   c. If no (only authority code present):
      - Fetch proj4 definition from https://epsg.io/{code}.proj4
      - proj4.defs('EPSG:{code}', fetchedDefinition)
   d. ol.proj.register(proj4)
   e. Set OL View projection to 'EPSG:{code}'
   f. OL automatically reprojects OSM tiles to that CRS
4. deck.gl geometry stays in its native CRS:
   - NO coordinate transformation via proj4js
   - WKB/WKT/GeoArrow data rendered as-is from the file
5. deck.gl overlay canvas is sized and positioned to match
   the OL viewport's native CRS coordinate space
```

**Geometry rendering:** For WKB/WKT encoded data, coordinates are parsed directly without reprojection. For GeoArrow native path, geometry is passed to deck.gl as-is. The data remains in the coordinate frame it was stored in the file.

**Visual alignment:** Both the basemap and geometry operate in the same CRS coordinate space:

- If the file's CRS is EPSG:3857 or EPSG:4326, the basemap is already in a compatible frame
- If the file's CRS is different (e.g., EPSG:25832), OL reprojects its OSM tiles to that CRS, and the geometry (in native coordinates) aligns naturally

**Fallback:** If the CRS code cannot be resolved (file lacks WKT definition and epsg.io is unavailable or returns unknown code), the app falls back to EPSG:4326 and shows a warning banner.

---

### 6.4 Geometry Encoding Strategy

GeoParquet supports three geometry encodings. The app reads the `encoding` field from the column entry in the `geo` metadata key and dispatches accordingly. All paths converge to a unified GeoArrow columnar format for rendering:

| Encoding value                                      | GeoParquet versions | Handling                                                                                 |
|-----------------------------------------------------|---------------------|------------------------------------------------------------------------------------------|
| `"WKB"`                                             | 1.0, 1.1            | DuckDB reads raw bytes → WKB parser → GeoArrow columnar format                           |
| `"geoarrow.point"` / `"geoarrow.multipolygon"` etc. | 1.1, 2.0            | Arrow column passed directly — zero-copy native GeoArrow path                            |
| `"WKT"`                                             | Legacy / edge cases | DuckDB `ST_AsWKB(ST_GeomFromText(...))` normalises to WKB, then GeoArrow columnar format |

**Unified rendering:** All encoding paths produce an Arrow Table with a GeoArrow geometry column. deck.gl's `BinaryGeometryLayer` from `@geoarrow/deck.gl-layers` consumes this directly, eliminating the need for GeoJsonLayer.

The encoding detection happens before any row data is fetched. The query is constructed dynamically based on the detected encoding.

---

### 6.5 Pagination Strategy

| Event                          | Behaviour                                                               |
|--------------------------------|-------------------------------------------------------------------------|
| File loaded + columns selected | Fetch first 1000 rows via `LIMIT 1000 OFFSET 0`                         |
| Total rows ≤ 1000              | Load all rows automatically, no pagination UI shown                     |
| Total rows > 1000              | Show row count badge + **Load more** (next 1000) + **Load all** buttons |
| Load more                      | `LIMIT 1000 OFFSET N`, append to existing table rows and map features   |
| Load all                       | `LIMIT {totalRows - 1000} OFFSET 1000` in one query                     |
| Filter applied                 | Reset offset to 0, re-fetch first 1000 with WHERE clause                |

The table uses **virtual scrolling** — only visible rows are rendered in the DOM regardless of how many rows are loaded in memory. Row height is fixed (28px) and total scrollable height is computed from `loadedRows * rowHeight`.

---

### 6.6 Metadata-First UX Flow

```
User opens app
      │
      ├─ No URL param → show LoadDataModal immediately
      │
      └─ URL param present → skip LoadDataModal, go straight to step below

User provides file/URL
      │
      ▼
DuckDB reads parquet_schema + parquet_kv_metadata + parquet_metadata
(no row data fetched yet)
      │
      ▼
MetadataModal opens automatically showing:
  ┌──────────────────────────────────────────────────┐
  │  PARQUET METADATA                                │
  │  File size, num rows, row groups, compression    │
  │                                                  │
  │  SCHEMA                                          │
  │  col name | type | encoding | nullable           │
  │  [✓] name        VARCHAR                         │
  │  [✓] population  INT64                           │
  │  [ ] geometry    BLOB  ← geo cols pre-excluded   │
  │                                                  │
  │  GEOPARQUET METADATA                             │
  │  CRS: EPSG:25832  Encoding: WKB                  │
  │  Geometry types: [Polygon]  BBox: [...]          │
  │                                                  │
  │  KVP METADATA                                    │
  │  key: value ...                                  │
  │                                                  │
  │               [ Cancel ]  [ Load Selected ]      │
  └──────────────────────────────────────────────────┘
      │
      ▼
User clicks Load Selected
      │
      ▼
Data fetch begins (DuckDB query with selected columns only)
Map view initialised to data CRS
First 1000 rows rendered
```

---