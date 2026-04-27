/**
 * DuckDB-WASM Data Layer
 *
 * Handles initialization, file loading, querying,
 * and metadata extraction for GeoParquet files.
 *
 * All WASM/worker assets are bundled locally — no external CDN dependency at runtime.
 */
import * as duckdb from '@duckdb/duckdb-wasm';

// Import WASM + worker assets as URLs so Vite copies them into the build output.
import duckdb_wasm_eh from '@duckdb/duckdb-wasm/dist/duckdb-eh.wasm?url';
import duckdb_worker_eh from '@duckdb/duckdb-wasm/dist/duckdb-browser-eh.worker.js?url';

let _db = null;
let _conn = null;
let _spatialLoaded = false;
let _initPromise = null;

// Cache: source → { geoColumn → boolean } for isGeometryType results.
// Avoids repeated DESCRIBE queries on every queryData/queryCount call.
const _geomTypeCache = new Map();

/**
 * Initialize DuckDB-WASM with required extensions.
 * WASM bundles are self-hosted (no external CDN dependency).
 */
export async function initDB(onProgress = () => {}) {
  if (_db) return { db: _db, conn: _conn };
  if (_initPromise) return _initPromise;

  _initPromise = (async () => {
    onProgress('Starting DuckDB...');

    // Always use EH (exception handling) bundle — required for spatial/PROJ operations.
    const mainModule = duckdb_wasm_eh;
    const mainWorker = duckdb_worker_eh;

    const worker = new Worker(mainWorker);
    const logger = new duckdb.ConsoleLogger(duckdb.LogLevel.WARNING);
    _db = new duckdb.AsyncDuckDB(logger, worker);
    await _db.instantiate(mainModule);

    onProgress('Opening database...');
    try {
      await _db.open({
        query: {
          castBigIntToDouble: true
        }
      });
    } catch {
      // Fallback: open without config if config format isn't supported
      await _db.open({});
    }

    _conn = await _db.connect();

    // Workaround for DuckDB-WASM PROJ initialization timing issue (#2199):
    // Load coordinate system data BEFORE loading spatial extension.
    onProgress('Preloading coordinate systems...');
    try {
      await _conn.query(`SELECT * FROM duckdb_coordinate_systems()`);
    } catch (e) {
      console.warn('Could not preload coordinate systems:', e.message);
    }

    onProgress('Loading httpfs extension...');
    try {
      await _conn.query(`INSTALL httpfs`);
      await _conn.query(`LOAD httpfs`);
      onProgress('httpfs extension loaded.');
    } catch (e) {
      console.warn('httpfs extension not available:', e.message);
      onProgress('httpfs extension unavailable — HTTP sources will not work.');
    }

    onProgress('Loading spatial extension...');
    try {
      await _conn.query(`INSTALL spatial`);
      await _conn.query(`LOAD spatial`);
      _spatialLoaded = true;
      onProgress('Spatial extension loaded.');
    } catch (e) {
      console.warn('Spatial extension not available:', e.message);
      onProgress('Spatial extension unavailable — using client-side WKB parsing.');
    }

    return { db: _db, conn: _conn };
  })();

  return _initPromise;
}

/** Whether the DuckDB spatial extension is loaded */
export function isSpatialLoaded() {
  return _spatialLoaded;
}

export async function getDB() {
  if (!_db) await initDB();
  return _db;
}

export async function getConnection() {
  if (!_conn) await initDB();
  return _conn;
}

/**
 * Execute a SQL query and return an Arrow Table.
 */
export async function query(sql) {
  const conn = await getConnection();
  return await conn.query(sql);
}

/**
 * Register a local file buffer in DuckDB.
 */
export async function registerLocalFile(name, buffer) {
  const db = await getDB();
  await db.registerFileBuffer(name, new Uint8Array(buffer));
}

/**
 * Drop a registered local file from DuckDB.
 */
export async function dropFile(name) {
  const db = await getDB();
  try {
    await db.dropFile(name);
  } catch {
    /* ignore */
  }
}

/**
 * Escape a source path for use in SQL strings.
 */
export function escapeSource(source) {
  return source.replace(/'/g, "''");
}

/**
 * Get column schema (names, types) from a Parquet file.
 */
export async function getSchema(source) {
  const escaped = escapeSource(source);
  const result = await query(`DESCRIBE SELECT * FROM read_parquet('${escaped}')`);
  return result.toArray().map((row) => ({
    name: String(row.column_name),
    type: String(row.column_type),
    nullable: String(row.null) === 'YES'
  }));
}

/**
 * Check whether a geometry column is already typed as GEOMETRY by DuckDB's spatial
 * extension (e.g. "GEOMETRY('EPSG:4258')") rather than a raw BLOB/VARCHAR.
 * When spatial is loaded, GeoParquet geometry columns are automatically decoded
 * to the GEOMETRY type, so ST_GeomFromWKB() must NOT be called on them.
 *
 * @param {string} source - Parquet source path.
 * @param {string} geoColumn - Name of the geometry column.
 * @returns {Promise<boolean>} true if the column type starts with "GEOMETRY".
 */
export async function isGeometryType(source, geoColumn) {
  // Check cache first to avoid repeated DESCRIBE queries.
  const cacheKey = source;
  if (_geomTypeCache.has(cacheKey)) {
    const cached = _geomTypeCache.get(cacheKey);
    if (geoColumn in cached) return cached[geoColumn];
  }
  try {
    const schema = await getSchema(source);
    // Cache results for ALL columns in one go.
    const entry = {};
    for (const col of schema) {
      entry[col.name] = col.type.toUpperCase().startsWith('GEOMETRY');
    }
    _geomTypeCache.set(cacheKey, entry);
    return entry[geoColumn] ?? false;
  } catch {
    return false;
  }
}

/**
 * Cache the geometry type detection from an already-fetched schema.
 * Call this after getSchema() to avoid a redundant DESCRIBE query later.
 */
export function cacheSchemaGeomTypes(source, schema) {
  const entry = {};
  for (const col of schema) {
    entry[col.name] = col.type.toUpperCase().startsWith('GEOMETRY');
  }
  _geomTypeCache.set(source, entry);
}

/**
 * Return a SQL expression that produces a GEOMETRY value from a geometry column,
 * handling both the case where DuckDB has already decoded it as GEOMETRY (spatial
 * extension loaded) and the raw BLOB/WKB case.
 *
 * @param {string} geoColumn - Column name.
 * @param {boolean} alreadyGeometry - true if the column is already GEOMETRY type.
 * @returns {string} SQL expression.
 */
function geomExpr(geoColumn, alreadyGeometry) {
  return alreadyGeometry ? `"${geoColumn}"` : `ST_GeomFromWKB("${geoColumn}")`;
}

/**
 * Get the total row count of a Parquet file.
 */
export async function getRowCount(source) {
  const escaped = escapeSource(source);
  const result = await query(`SELECT COUNT(*) as cnt FROM read_parquet('${escaped}')`);
  return Number(result.toArray()[0].cnt);
}

/**
 * Bootstrap all file metadata in minimal round-trips.
 * Combines schema, row count, row group size, and KV metadata into a single flow.
 * For remote files this dramatically reduces HTTP range request overhead since
 * DuckDB caches the Parquet footer after the first metadata function call.
 *
 * @param {string} source - Parquet source path.
 * @param {Function} onProgress - Status callback.
 * @returns {Promise<{schema, totalRows, rowGroupSize, kvMetadata, geoMetadata, fileMetadata}>}
 */
export async function bootstrapMetadata(source, onProgress = () => {}) {
  const escaped = escapeSource(source);

  // 1. Schema — also populates geometry type cache for queryData/queryCount
  onProgress('Reading schema...');
  const schemaResult = await query(`DESCRIBE SELECT * FROM read_parquet('${escaped}')`);
  const schema = schemaResult.toArray().map((row) => ({
    name: String(row.column_name),
    type: String(row.column_type),
    nullable: String(row.null) === 'YES'
  }));
  cacheSchemaGeomTypes(source, schema);

  // 2. Row count + row group size (footer now cached from step 1)
  onProgress('Reading parquet stats...');
  let totalRows = -1;
  let rowGroupSize = null;
  try {
    const statsResult = await query(
      `SELECT SUM(row_group_num_rows) AS total_rows,
              FIRST(row_group_num_rows) AS first_rg_size
       FROM (SELECT DISTINCT row_group_id, row_group_num_rows
             FROM parquet_metadata('${escaped}'))`
    );
    const statsRow = statsResult.toArray()[0];
    totalRows = Number(statsRow.total_rows);
    const rgSize = Number(statsRow.first_rg_size);
    rowGroupSize = rgSize > 0 ? rgSize : null;
  } catch (e) {
    console.warn('parquet_metadata failed, falling back to COUNT(*):', e.message);
    try {
      const countResult = await query(`SELECT COUNT(*) as cnt FROM read_parquet('${escaped}')`);
      totalRows = Number(countResult.toArray()[0].cnt);
    } catch {
      /* leave as -1 */
    }
  }

  // 3. KV metadata (includes GeoParquet 'geo' key)
  onProgress('Reading KV metadata...');
  let kvMetadata = null;
  let geoMetadata = null;
  try {
    const kvResult = await query(`SELECT key, value FROM parquet_kv_metadata('${escaped}')`);
    kvMetadata = {};
    for (const row of kvResult.toArray()) {
      const key = blobToString(row.key);
      let value = blobToString(row.value);
      try {
        value = JSON.parse(value);
      } catch {
        /* keep as string */
      }
      kvMetadata[key] = value;
    }
    if (kvMetadata.geo && typeof kvMetadata.geo === 'object') {
      geoMetadata = kvMetadata.geo;
    }
  } catch (e) {
    console.warn('Could not read KV metadata:', e.message);
  }

  // 4. File-level schema metadata (parquet_schema)
  let fileMetadata = null;
  try {
    const fileResult = await query(`SELECT * FROM parquet_schema('${escaped}')`);
    fileMetadata = fileResult.toArray().map((row) => {
      const obj = {};
      for (const field of fileResult.schema.fields) {
        const v = row[field.name];
        obj[field.name] = typeof v === 'bigint' ? Number(v) : v;
      }
      return obj;
    });
  } catch (e) {
    console.warn('Could not read file metadata:', e.message);
  }

  return { schema, totalRows, rowGroupSize, kvMetadata, geoMetadata, fileMetadata };
}

/**
 * Decode a value that may be a BLOB (Uint8Array/ArrayBuffer) to a UTF-8 string.
 */
function blobToString(val) {
  if (val instanceof Uint8Array) return new TextDecoder().decode(val);
  if (ArrayBuffer.isView(val))
    return new TextDecoder().decode(new Uint8Array(val.buffer, val.byteOffset, val.byteLength));
  if (val instanceof ArrayBuffer) return new TextDecoder().decode(val);
  return String(val);
}

/**
 * Transform a WGS84 bbox [west, south, east, north] into the given source CRS.
 * Transforms all four corners and returns [minx, miny, maxx, maxy] in source CRS units.
 * Requires the spatial extension to be loaded.
 *
 * @param {number[]} bbox - [west, south, east, north] in WGS84.
 * @param {string} sourceCrs - PROJJSON string of the target CRS.
 * @returns {Promise<number[]>} [minx, miny, maxx, maxy] in source CRS.
 */
export async function transformBbox(bbox, sourceCrs) {
  const [west, south, east, north] = bbox;
  const crsLiteral = sourceCrs.replace(/'/g, "''");
  const result = await query(
    `SELECT MIN(x) as minx, MIN(y) as miny, MAX(x) as maxx, MAX(y) as maxy FROM (
       SELECT ST_X(ST_Transform(ST_Point(${west}, ${south}), 'EPSG:4326', '${crsLiteral}', true)) as x,
              ST_Y(ST_Transform(ST_Point(${west}, ${south}), 'EPSG:4326', '${crsLiteral}', true)) as y
       UNION ALL
       SELECT ST_X(ST_Transform(ST_Point(${east}, ${south}), 'EPSG:4326', '${crsLiteral}', true)),
              ST_Y(ST_Transform(ST_Point(${east}, ${south}), 'EPSG:4326', '${crsLiteral}', true))
       UNION ALL
       SELECT ST_X(ST_Transform(ST_Point(${east}, ${north}), 'EPSG:4326', '${crsLiteral}', true)),
              ST_Y(ST_Transform(ST_Point(${east}, ${north}), 'EPSG:4326', '${crsLiteral}', true))
       UNION ALL
       SELECT ST_X(ST_Transform(ST_Point(${west}, ${north}), 'EPSG:4326', '${crsLiteral}', true)),
              ST_Y(ST_Transform(ST_Point(${west}, ${north}), 'EPSG:4326', '${crsLiteral}', true))
     )`
  );
  const row = result.toArray()[0];
  return [Number(row.minx), Number(row.miny), Number(row.maxx), Number(row.maxy)];
}

/**
 * Convert a GeoParquet covering column path array to a DuckDB SQL expression.
 * e.g. ["bbox", "xmin"] → struct_extract("bbox", 'xmin')
 *      ["xmin"] → "xmin"
 */
function coveringPathToSql(path) {
  let expr = `"${path[0]}"`;
  for (let i = 1; i < path.length; i++) {
    expr = `struct_extract(${expr}, '${path[i]}')`;
  }
  return expr;
}

/**
 * Get the count of rows matching the given filters and optional bbox.
 */
export async function queryCount(
  source,
  filters = [],
  bbox = null,
  geoColumn = null,
  sourceCrs = null,
  alreadyGeometry = null,
  bboxCovering = null
) {
  const escaped = escapeSource(source);
  let isAlreadyGeom = alreadyGeometry;
  if (isAlreadyGeom === null && geoColumn && _spatialLoaded) {
    isAlreadyGeom = await isGeometryType(source, geoColumn);
  }
  // Pre-transform viewport bbox to source CRS when using covering columns.
  let effectiveBbox = bbox;
  if (bbox && bboxCovering && sourceCrs && _spatialLoaded) {
    try {
      effectiveBbox = await transformBbox(bbox, sourceCrs);
    } catch (e) {
      console.warn('Failed to transform bbox for queryCount:', e.message);
    }
  }
  const where = buildWhereClause(
    filters,
    effectiveBbox,
    geoColumn,
    sourceCrs,
    isAlreadyGeom ?? false,
    bboxCovering
  );
  const result = await query(`SELECT COUNT(*) as cnt FROM read_parquet('${escaped}')${where}`);
  return Number(result.toArray()[0].cnt);
}

/**
 * Query data with optional filters, column selection, pagination.
 *
 * Reprojection is performed in DuckDB whenever spatial is loaded and sourceCrs is set.
 *
 * Returns an Arrow Table. Each row may have:
 *  - __wkb      (blob)   — when spatial is loaded
 *  - [geoColumn] (raw WKB blob) — always present for fallback
 */
export async function queryData(
  source,
  {
    geoColumn = null,
    filters = [],
    bbox = null,
    sourceCrs = null,
    limit = null,
    offset = 0,
    alreadyGeometry = null,
    columns = null,
    bboxCovering = null
  } = {}
) {
  const escaped = escapeSource(source);

  // If the caller hasn't told us whether the column is already a GEOMETRY type,
  // detect it now. This matters because DuckDB spatial auto-decodes GeoParquet
  // geometry columns to GEOMETRY, making ST_GeomFromWKB() fail with a type error.
  let isAlreadyGeom = alreadyGeometry;
  if (isAlreadyGeom === null && geoColumn && _spatialLoaded) {
    isAlreadyGeom = await isGeometryType(source, geoColumn);
  }

  // Pre-transform viewport bbox to source CRS when using covering columns.
  let effectiveBbox = bbox;
  if (bbox && bboxCovering && sourceCrs && _spatialLoaded) {
    try {
      effectiveBbox = await transformBbox(bbox, sourceCrs);
    } catch (e) {
      console.warn('Failed to transform bbox for queryData:', e.message);
    }
  }

  // Build WHERE clause (filters + optional viewport bbox).
  const where = buildWhereClause(
    filters,
    effectiveBbox,
    geoColumn,
    sourceCrs,
    isAlreadyGeom,
    bboxCovering
  );

  let geoSelect = '';
  if (geoColumn && _spatialLoaded) {
    const baseExpr = geomExpr(geoColumn, isAlreadyGeom);
    if (sourceCrs) {
      // Reproject to WGS84 when source CRS is known.
      const crsLiteral = sourceCrs.replace(/'/g, "''");
      const transformedExpr = `ST_Transform(${baseExpr}, '${crsLiteral}', 'EPSG:4326', true)`;
      geoSelect = `, ST_AsWKB(${transformedExpr}) as __wkb`;
    } else {
      // Data already in WGS84 (or no CRS metadata) — export as WKB.
      geoSelect = `, ST_AsWKB(${baseExpr}) as __wkb`;
    }
  }

  let pagination = '';
  if (limit) {
    pagination = ` LIMIT ${limit} OFFSET ${offset}`;
  } else if (offset > 0) {
    pagination = ` OFFSET ${offset}`;
  }

  // Select only requested columns (+ geo) instead of * when a column list is provided.
  // This avoids fetching large unused columns (bbox structs, binary blobs, etc.)
  // and significantly reduces data transfer for wide tables.
  let selectCols = '*';
  if (columns && columns.length > 0) {
    selectCols = columns.map((c) => `"${c}"`).join(', ');
  }

  const sql = `SELECT ${selectCols}${geoSelect} FROM read_parquet('${escaped}')${where}${pagination}`;

  return query(sql);
}

/**
 * Build a SQL WHERE clause from user filters + optional viewport bbox.
 *
 * When bboxCovering is provided, uses direct column comparisons on the covering bbox
 * columns for efficient Parquet predicate pushdown. The bbox should already be in
 * source CRS coordinates (pre-transformed by the caller).
 *
 * When bboxCovering is absent and spatial is loaded, falls back to ST_Intersects.
 */
function buildWhereClause(
  filters,
  bbox = null,
  geoColumn = null,
  sourceCrs = null,
  alreadyGeometry = false,
  bboxCovering = null
) {
  const conditions = [];

  if (filters && filters.length > 0) {
    const fc = filters
      .filter(
        (f) =>
          f.column &&
          f.operator &&
          (f.value !== '' || ['IS NULL', 'IS NOT NULL'].includes(f.operator))
      )
      .map((f) => buildFilterCondition(f));
    conditions.push(...fc);
  }

  if (bbox && geoColumn) {
    const [west, south, east, north] = bbox;
    if (bboxCovering) {
      // Fast path: compare directly against bbox covering columns.
      // bbox is already in source CRS (pre-transformed by caller when needed).
      // This allows Parquet to apply predicate pushdown on column statistics.
      const xmin = coveringPathToSql(bboxCovering.xmin);
      const ymin = coveringPathToSql(bboxCovering.ymin);
      const xmax = coveringPathToSql(bboxCovering.xmax);
      const ymax = coveringPathToSql(bboxCovering.ymax);
      conditions.push(
        `${xmax} >= ${west} AND ${xmin} <= ${east} AND ${ymax} >= ${south} AND ${ymin} <= ${north}`
      );
    } else if (_spatialLoaded) {
      // Slow path fallback: full per-row spatial intersection.
      const envelope = `ST_MakeEnvelope(${west}, ${south}, ${east}, ${north})`;
      const baseExpr = geomExpr(geoColumn, alreadyGeometry);
      if (sourceCrs) {
        const crsLiteral = sourceCrs.replace(/'/g, "''");
        conditions.push(
          `ST_Intersects(${baseExpr}, ST_Transform(${envelope}, 'EPSG:4326', '${crsLiteral}', true))`
        );
      } else {
        conditions.push(`ST_Intersects(${baseExpr}, ${envelope})`);
      }
    }
  }

  if (conditions.length === 0) return '';
  return ' WHERE ' + conditions.join(' AND ');
}

function buildFilterCondition(filter) {
  const col = `"${filter.column}"`;
  const val = escapeSource(String(filter.value));

  switch (filter.operator) {
    case '=':
      return `CAST(${col} AS VARCHAR) = '${val}'`;
    case '!=':
      return `CAST(${col} AS VARCHAR) != '${val}'`;
    case '>':
      return `${col} > ${val}`;
    case '>=':
      return `${col} >= ${val}`;
    case '<':
      return `${col} < ${val}`;
    case '<=':
      return `${col} <= ${val}`;
    case 'LIKE':
      return `CAST(${col} AS VARCHAR) ILIKE '%${val}%'`;
    case 'IS NULL':
      return `${col} IS NULL`;
    case 'IS NOT NULL':
      return `${col} IS NOT NULL`;
    default:
      return `CAST(${col} AS VARCHAR) = '${val}'`;
  }
}
