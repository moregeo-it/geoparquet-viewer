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
  try {
    const schema = await getSchema(source);
    const col = schema.find((c) => c.name === geoColumn);
    return col ? col.type.toUpperCase().startsWith('GEOMETRY') : false;
  } catch {
    return false;
  }
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
  return alreadyGeometry
    ? `"${geoColumn}"`
    : `ST_GeomFromWKB("${geoColumn}")`;
}

/**
 * Get the total row count of a Parquet file.
 */
export async function getRowCount(source) {
  const escaped = escapeSource(source);
  const result = await query(
    `SELECT COUNT(*) as cnt FROM read_parquet('${escaped}')`
  );
  return Number(result.toArray()[0].cnt);
}

/**
 * Decode a value that may be a BLOB (Uint8Array/ArrayBuffer) to a UTF-8 string.
 */
function blobToString(val) {
  if (val instanceof Uint8Array) return new TextDecoder().decode(val);
  if (ArrayBuffer.isView(val)) return new TextDecoder().decode(new Uint8Array(val.buffer, val.byteOffset, val.byteLength));
  if (val instanceof ArrayBuffer) return new TextDecoder().decode(val);
  return String(val);
}

/**
 * Get Parquet key-value metadata.
 * Returns an object with string keys and parsed (JSON or string) values.
 */
export async function getKVMetadata(source) {
  const escaped = escapeSource(source);
  const result = await query(
    `SELECT key, value FROM parquet_kv_metadata('${escaped}')`
  );
  const metadata = {};
  for (const row of result.toArray()) {
    const key = blobToString(row.key);
    let value = blobToString(row.value);
    try {
      value = JSON.parse(value);
    } catch {
      /* keep as string */
    }
    metadata[key] = value;
  }
  return metadata;
}

/**
 * Get Parquet file-level metadata (schema info).
 */
export async function getParquetFileMetadata(source) {
  const escaped = escapeSource(source);
  const result = await query(
    `SELECT * FROM parquet_schema('${escaped}')`
  );
  return result.toArray().map((row) => {
    const obj = {};
    for (const field of result.schema.fields) {
      const v = row[field.name];
      obj[field.name] = typeof v === 'bigint' ? Number(v) : v;
    }
    return obj;
  });
}

/**
 * Get the first row group's row count from a Parquet file.
 * Uses a minimal query — fetches a single scalar value.
 * @param {string} source - Parquet source path.
 * @returns {Promise<number|null>} Row count of the first row group, or null if unavailable.
 */
export async function getRowGroupSize(source) {
  const escaped = escapeSource(source);
  const result = await query(
    `SELECT row_group_num_rows FROM parquet_metadata('${escaped}') LIMIT 1`
  );
  const rows = result.toArray();
  if (rows.length === 0) return null;
  const size = Number(rows[0].row_group_num_rows);
  return size > 0 ? size : null;
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
  alreadyGeometry = null
) {
  const escaped = escapeSource(source);
  let isAlreadyGeom = alreadyGeometry;
  if (isAlreadyGeom === null && geoColumn && _spatialLoaded) {
    isAlreadyGeom = await isGeometryType(source, geoColumn);
  }
  const where = buildWhereClause(filters, bbox, geoColumn, sourceCrs, isAlreadyGeom ?? false);
  const result = await query(
    `SELECT COUNT(*) as cnt FROM read_parquet('${escaped}')${where}`
  );
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
  { geoColumn = null, filters = [], bbox = null, sourceCrs = null, limit = null, offset = 0, alreadyGeometry = null } = {}
) {
  const escaped = escapeSource(source);

  // If the caller hasn't told us whether the column is already a GEOMETRY type,
  // detect it now. This matters because DuckDB spatial auto-decodes GeoParquet
  // geometry columns to GEOMETRY, making ST_GeomFromWKB() fail with a type error.
  let isAlreadyGeom = alreadyGeometry;
  if (isAlreadyGeom === null && geoColumn && _spatialLoaded) {
    isAlreadyGeom = await isGeometryType(source, geoColumn);
  }

  // Build WHERE clause (filters + optional viewport bbox).
  const where = buildWhereClause(filters, bbox, geoColumn, sourceCrs, isAlreadyGeom);

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

  const sql = `SELECT *${geoSelect} FROM read_parquet('${escaped}')${where}${pagination}`;

  return query(sql);
}

/**
 * Build a SQL WHERE clause from user filters + optional viewport bbox.
 */
function buildWhereClause(filters, bbox = null, geoColumn = null, sourceCrs = null, alreadyGeometry = false) {
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

  // Spatial viewport bbox filter — only when spatial extension is loaded.
  if (bbox && geoColumn && _spatialLoaded) {
    const [west, south, east, north] = bbox;
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
