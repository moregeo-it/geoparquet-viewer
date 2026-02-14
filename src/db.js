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
// This eliminates any runtime CDN dependency.
import duckdb_wasm from '@duckdb/duckdb-wasm/dist/duckdb-mvp.wasm?url';
import duckdb_worker from '@duckdb/duckdb-wasm/dist/duckdb-browser-mvp.worker.js?url';
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
    // Pick the best bundle directly — bypass selectBundle() which can hang
    // with self-hosted URLs. All modern browsers support EH; fall back to MVP.
    onProgress('Starting DuckDB...');
    let mainModule = duckdb_wasm_eh;
    let mainWorker = duckdb_worker_eh;
    try {
      // Quick feature-detect: if EH (exception handling) is supported, use it
      new WebAssembly.Exception(new WebAssembly.Tag({ parameters: [] }));
    } catch {
      mainModule = duckdb_wasm;
      mainWorker = duckdb_worker;
    }

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

    // Try to load spatial extension for GeoParquet geometry support
    onProgress('Loading spatial extension...');
    try {
      await _conn.query(`INSTALL spatial`);
      await _conn.query(`LOAD spatial`);
      _spatialLoaded = true;
      onProgress('Spatial extension loaded.');
    } catch (e) {
      console.warn('Spatial extension not available:', e.message);
      onProgress('Spatial extension not available. Using client-side WKB parsing.');
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
  return conn.query(sql);
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
 * Note: DuckDB returns both key and value as BLOB from parquet_kv_metadata.
 */
export async function getKVMetadata(source) {
  const escaped = escapeSource(source);
  const result = await query(
    `SELECT key, value FROM parquet_kv_metadata('${escaped}')`
  );
  const metadata = {};
  for (const row of result.toArray()) {
    // Both key and value come as BLOB (Uint8Array) from DuckDB Arrow
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
 * Get Parquet file-level metadata (row groups, column statistics).
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
 * Get the count of rows matching the given filters and optional bbox.
 */
export async function queryCount(source, filters = [], bbox = null, geoColumn = null, sourceCrs = null) {
  const escaped = escapeSource(source);
  const where = buildWhereClause(filters, bbox, geoColumn, sourceCrs);
  const result = await query(
    `SELECT COUNT(*) as cnt FROM read_parquet('${escaped}')${where}`
  );
  return Number(result.toArray()[0].cnt);
}

/**
 * Query data with optional filters, column selection, pagination.
 * Returns { arrowTable, rows, features }.
 */
export async function queryData(
  source,
  { geoColumn = null, filters = [], bbox = null, sourceCrs = null, limit = null, offset = 0 } = {}
) {
  const escaped = escapeSource(source);

  // Build WHERE clause (includes user filters + viewport bbox)
  const where = buildWhereClause(filters, bbox, geoColumn, sourceCrs);

  // If spatial is loaded and we have a geo column, add GeoJSON conversion
  // When source CRS is not WGS 84, reproject with ST_Transform first
  // Note: read_parquet() returns geometry as WKB BLOB, not GEOMETRY type.
  // ST_GeomFromWKB() is needed to convert before ST_Transform can reproject.
  let geoSelect = '';
  if (geoColumn && _spatialLoaded) {
    let geoExpr = `"${geoColumn}"`;
    if (sourceCrs) {
      const crsLiteral = sourceCrs.replace(/'/g, "''");
      geoExpr = `ST_Transform(ST_GeomFromWKB("${geoColumn}"), '${crsLiteral}', 'EPSG:4326', true)`;
    }
    geoSelect = `, ST_AsGeoJSON(${geoExpr}) as __geojson`;
  }

  // Build pagination
  let pagination = '';
  if (limit) {
    pagination = ` LIMIT ${limit} OFFSET ${offset}`;
  }

  const sql = `SELECT *${geoSelect} FROM read_parquet('${escaped}')${where}${pagination}`;
  console.log('Query:', sql);
  return query(sql);
}

/**
 * Build a SQL WHERE clause from user filters + optional viewport bbox.
 */
function buildWhereClause(filters, bbox = null, geoColumn = null, sourceCrs = null) {
  const conditions = [];

  // User-defined column filters
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

  // Spatial viewport bbox filter (requires spatial extension)
  // Viewport bbox is always in EPSG:4326; transform to source CRS if needed
  if (bbox && geoColumn && _spatialLoaded) {
    const [west, south, east, north] = bbox;
    const envelope = `ST_MakeEnvelope(${west}, ${south}, ${east}, ${north})`;
    if (sourceCrs) {
      const crsLiteral = sourceCrs.replace(/'/g, "''");
      conditions.push(
        `ST_Intersects(ST_GeomFromWKB("${geoColumn}"), ST_Transform(${envelope}, 'EPSG:4326', '${crsLiteral}', true))`
      );
    } else {
      conditions.push(
        `ST_Intersects("${geoColumn}", ${envelope})`
      );
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
