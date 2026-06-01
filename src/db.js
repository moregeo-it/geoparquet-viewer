/**
 * DuckDB-WASM Data Layer
 *
 * Handles initialization, file loading, querying,
 * and metadata extraction for GeoParquet files.
 *
 * All WASM/worker assets are bundled locally — no external CDN dependency at runtime.
 */

/** Resolve a Vite asset URL to an absolute HTTP URL for DuckDB's LOAD command. */
const absExtUrl = (url) => new URL(url, location.href).href;

let _db = null;
let _conn = null;
let _initPromise = null;
let _lastProgressMsg = null;

const _progressListeners = new Set();

function _emitProgress(msg) {
  _lastProgressMsg = msg; // Cache last message for late-joining listeners during init.
  for (const fn of _progressListeners) fn(msg); // Emit to all listeners.
}

/**
 * Initialize DuckDB-WASM with required extensions.
 * WASM bundles are self-hosted (no external CDN dependency).
 *
 * @param {Function} onProgress - Optional callback to receive progress messages during initialization.
 * @returns {Promise} Resolves when initialization is complete.
 */
export async function initDB(onProgress) {
  if (_db && _conn) {
    return Promise.resolve();
  }

  // Register late-joining progress listener so callers see remaining init steps.
  if (onProgress) {
    _progressListeners.add(onProgress);
    if (_lastProgressMsg) onProgress(_lastProgressMsg);
  }

  if (_initPromise) {
    return _initPromise;
  }

  _initPromise = (async () => {
    _emitProgress('Loading DuckDB...');

    const promises = [
      import('@duckdb/duckdb-wasm'),
      import('@duckdb/duckdb-wasm/dist/duckdb-eh.wasm?url'),
      import('@duckdb/duckdb-wasm/dist/duckdb-browser-eh.worker.js?url'),
      import('../extensions/httpfs.duckdb_extension.wasm?url'),
      import('../extensions/spatial.duckdb_extension.wasm?url'),
      import('../extensions/parquet.duckdb_extension.wasm?url'),
      import('../extensions/duck_geoarrow.duckdb_extension.wasm?url')
    ];

    const modules = await Promise.all(promises);
    const [
      duckdb,
      duckdb_wasm_eh,
      duckdb_worker_eh,
      httpfsExtUrl,
      spatialExtUrl,
      parquetExtUrl,
      duckGeoArrowExtUrl
    ] = modules;

    const mainModule = duckdb_wasm_eh.default;
    const mainWorker = duckdb_worker_eh.default;
    const httpfsExt = httpfsExtUrl.default;
    const spatialExt = spatialExtUrl.default;
    const parquetExt = parquetExtUrl.default;
    const duckGeoArrowExt = duckGeoArrowExtUrl.default;

    _emitProgress('Starting DuckDB...');

    let worker = new Worker(mainWorker);

    const logger = new duckdb.ConsoleLogger(duckdb.LogLevel.WARNING);
    _db = new duckdb.AsyncDuckDB(logger, worker);

    await _db.instantiate(mainModule);

    _emitProgress('Opening database...');
    await _db.open({});

    _emitProgress('Connection to database...');
    _conn = await _db.connect();

    // Workaround for DuckDB-WASM PROJ initialization timing issue (#2199):
    // Load coordinate system data BEFORE loading spatial extension.
    _emitProgress('Preloading coordinate systems...');
    try {
      await _conn.query(`SELECT * FROM duckdb_coordinate_systems()`);
    } catch (e) {
      throw new Error('Failed to load coordinate reference systems', { cause: e });
    }

    const loadExtension = async (name, url, unavailableMsg) => {
      _emitProgress(`Loading ${name} extension...`);
      try {
        await _conn.query(`LOAD '${absExtUrl(url)}'`);
      } catch (e) {
        throw new Error(`Failed to load ${name} extension: ${e.message}. ${unavailableMsg}`, {
          cause: e
        });
      }
    };

    await loadExtension('parquet', parquetExt, 'No data can be loaded.');
    await loadExtension('httpfs', httpfsExt, 'All files will be fully loaded into memory.');
    await loadExtension('spatial', spatialExt, 'Only WGS84-based datasets will show on the map.');
    await loadExtension('duck_geoarrow', duckGeoArrowExt, 'GeoArrow support is unavailable.');

    _progressListeners.clear();
  })();

  return _initPromise;
}

export async function getDB() {
  return _db;
}

export async function getConnection() {
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
 * Return a SQL expression that produces a GEOMETRY value from a geometry column,
 * handling both the case where DuckDB has already decoded it as GEOMETRY (spatial
 * extension loaded) and the raw BLOB/WKB case.
 *
 * @param {string} geoColumn - Column name.
 * @param {string} encoding - Encoding type ('geometry', 'wkb', 'geoarrow_native').
 * @returns {string} SQL expression.
 */
function geomExpr(geoColumn, encoding) {
  switch (encoding?.toLowerCase()) {
    case 'wkb':
    case undefined:
    case null:
      return `"${geoColumn}"`;

    case 'wkt':
      return `ST_GeomFromText("${geoColumn}")`;

    case 'point':
      return `ST_Point("${geoColumn}".x, "${geoColumn}".y)`;
    case 'linestring':
    case 'polygon':
    case 'multipoint':
    case 'multilinestring':
    case 'multipolygon':
      return null;

    default:
      // Fallback to WKB parsing for unknown types — allows some level of support for custom encodings and GeoArrow structs.
      return `ST_GeomFromWKB("${geoColumn}")`;
  }
}

/**
 * Bootstrap all file metadata in minimal round-trips.
 * Combines schema, row count, row group size, and KV metadata into a single flow.
 * For remote files this dramatically reduces HTTP range request overhead since
 * DuckDB caches the Parquet footer after the first metadata function call.
 *
 * @param {string} source - Parquet source path.
 * @param {Function} onProgress - Status callback.
 * @returns {Promise<{schema, totalRows, rowGroupSize, fileInfo, kvMetadata, geoMetadata, parquetSchema, columnSizes}>}
 */
export async function bootstrapMetadata(source, onProgress = () => {}) {
  const escaped = escapeSource(source);

  // 1. Schema — also populates geometry type cache for queryData/queryCount
  onProgress('Reading schema...');
  const schema = await getSchema(source);

  // Attempt to get row group size from parquet_metadata() for better pagination defaults.
  onProgress('Reading row group metadata...');
  let rowGroupSize = null;
  try {
    const statsResult = await query(
      `SELECT FIRST(row_group_num_rows) AS first_rg_size FROM parquet_metadata('${escaped}') LiMIT 1`
    );
    const statsRow = statsResult.toArray()[0];
    const rgSize = Number(statsRow.first_rg_size);
    rowGroupSize = rgSize > 0 ? rgSize : null;
  } catch (e) {
    console.warn('Could not read row group size:', e.message);
  }

  // 2. File-level metadata (num_rows, num_row_groups, format_version, etc.)
  onProgress('Reading file metadata...');
  let fileInfo = null;
  let totalRows = -1;
  try {
    const fileResult = await query(`SELECT * FROM parquet_file_metadata('${escaped}')`);
    const row = fileResult.toArray()[0];
    fileInfo = {};
    for (const field of fileResult.schema.fields) {
      const v = row[field.name];
      fileInfo[field.name] = typeof v === 'bigint' ? Number(v) : v;
    }
    totalRows = fileInfo.num_rows ?? -1;
  } catch (e) {
    console.warn('parquet_file_metadata failed, falling back to COUNT(*):', e.message);
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

  // 4. Parquet internal schema (tree structure with num_children)
  onProgress('Reading parquet schema...');
  let parquetSchema = null;
  try {
    const schemaFileResult = await query(`SELECT * FROM parquet_schema('${escaped}')`);
    parquetSchema = schemaFileResult.toArray().map((row) => {
      const obj = {};
      for (const field of schemaFileResult.schema.fields) {
        if (field.name === 'file_name') continue;
        const v = row[field.name];
        obj[field.name] = typeof v === 'bigint' ? Number(v) : v;
      }
      return obj;
    });
  } catch (e) {
    console.warn('Could not read parquet schema:', e.message);
  }

  // 5. Column sizes for first row group (used for load-time warnings)
  let columnSizes = null;
  try {
    const colSizeResult = await query(
      `SELECT path_in_schema, total_compressed_size
       FROM parquet_metadata('${escaped}')
       WHERE row_group_id = 0`
    );
    columnSizes = {};
    for (const row of colSizeResult.toArray()) {
      columnSizes[String(row.path_in_schema)] = Number(row.total_compressed_size);
    }
  } catch (e) {
    console.warn('Could not read column sizes:', e.message);
  }

  return {
    schema,
    totalRows,
    rowGroupSize,
    fileInfo,
    kvMetadata,
    geoMetadata,
    parquetSchema,
    columnSizes
  };
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
 * Query per-column, per-row-group Parquet metadata (lazy — can be large).
 * Used by the Parquet Column Stats modal.
 *
 * @param {string} source - Parquet source path.
 * @returns {Promise<Array>} Array of row objects from parquet_metadata().
 */
export async function queryParquetStats(source) {
  const escaped = escapeSource(source);
  const result = await query(
    `SELECT row_group_id, row_group_num_rows, column_id, path_in_schema,
            type, compression, encodings, num_values,
            stats_min_value, stats_max_value, stats_null_count,
            total_compressed_size, total_uncompressed_size
     FROM parquet_metadata('${escaped}')
     ORDER BY row_group_id, column_id`
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
 * Transform a bbox [west, south, east, north] from sourceCrs to targetCrs.
 * Uses ST_MakeEnvelope + ST_Transform to project the envelope polygon, then extracts bounds.
 * Requires the spatial extension to be loaded.
 *
 * @param {number[]} bbox - [west, south, east, north] in sourceCrs.
 * @param {string} sourceCrs - PROJJSON string or EPSG code of the source CRS.
 * @param {string} targetCrs - PROJJSON string or EPSG code of the target CRS.
 * @returns {Promise<number[]>} [minx, miny, maxx, maxy] in targetCrs.
 */
export async function transformBbox(bbox, sourceCrs, targetCrs) {
  const [west, south, east, north] = bbox;
  const srcLiteral = sourceCrs.replace(/'/g, "''");
  const tgtLiteral = targetCrs.replace(/'/g, "''");
  const result = await query(
    `SELECT ST_XMin(g) as minx, ST_YMin(g) as miny, ST_XMax(g) as maxx, ST_YMax(g) as maxy
     FROM (SELECT ST_Transform(ST_MakeEnvelope(${west}, ${south}, ${east}, ${north}), '${srcLiteral}', '${tgtLiteral}', true) as g)`
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
  bboxCovering = null
) {
  const escaped = escapeSource(source);
  // Pre-transform viewport bbox to source CRS when using covering columns.
  let effectiveBbox = bbox;
  if (bbox && bboxCovering && sourceCrs) {
    try {
      effectiveBbox = await transformBbox(bbox, 'EPSG:4326', sourceCrs);
    } catch (e) {
      console.warn('Failed to transform bbox for queryCount:', e.message);
    }
  }
  const where = buildWhereClause(filters, effectiveBbox, geoColumn, bboxCovering);
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
    encoding = null,
    filters = [],
    bbox = null,
    sourceCrs = null,
    limit = null,
    offset = 0,
    columns = null,
    bboxCovering = null
  } = {}
) {
  const escaped = escapeSource(source);

  // Pre-transform viewport bbox to source CRS when using covering columns.
  let effectiveBbox = bbox;
  if (bbox && bboxCovering && sourceCrs) {
    try {
      effectiveBbox = await transformBbox(bbox, 'EPSG:4326', sourceCrs);
    } catch (e) {
      console.warn('Failed to transform bbox for queryData:', e.message);
    }
  }

  // Build WHERE clause (filters + optional viewport bbox).
  const where = buildWhereClause(filters, effectiveBbox, geoColumn, bboxCovering);

  let isNative = false;
  let geoSelect = '';
  if (geoColumn) {
    const baseExpr = geomExpr(geoColumn, encoding);
    if (baseExpr === null) {
      isNative = true;
    } else if (sourceCrs) {
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

  const table = await query(sql);

  if (isNative) {
    table._isNativeGeoArrow = true;
  }

  return table;
}

/**
 * Build a SQL WHERE clause from user filters + optional viewport bbox.
 *
 * When bboxCovering is provided, uses direct column comparisons on the covering bbox
 * columns for efficient Parquet predicate pushdown. The bbox should already be in
 * source CRS coordinates (pre-transformed by the caller).
 *
 * Without bboxCovering, no spatial filtering is applied (bbox is ignored).
 */
function buildWhereClause(filters, bbox = null, geoColumn = null, bboxCovering = null) {
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

  if (bbox && geoColumn && bboxCovering) {
    const [west, south, east, north] = bbox;
    // Compare directly against bbox covering columns.
    // bbox is already in source CRS (pre-transformed by caller when needed).
    // This allows Parquet to apply predicate pushdown on column statistics.
    const xmin = coveringPathToSql(bboxCovering.xmin);
    const ymin = coveringPathToSql(bboxCovering.ymin);
    const xmax = coveringPathToSql(bboxCovering.xmax);
    const ymax = coveringPathToSql(bboxCovering.ymax);
    conditions.push(
      `${xmax} >= ${west} AND ${xmin} <= ${east} AND ${ymax} >= ${south} AND ${ymin} <= ${north}`
    );
  }

  if (conditions.length === 0) return '';
  return ' WHERE ' + conditions.join(' AND ');
}

const ALLOWED_BINARY_OPS = new Set(['=', '!=', '>', '>=', '<', '<=']);
const ALLOWED_UNARY_OPS = new Set([
  'IS NULL',
  'IS NOT NULL',
  'IS TRUE',
  'IS NOT TRUE',
  'IS FALSE',
  'IS NOT FALSE'
]);

function buildFilterCondition(filter) {
  const col = `"${filter.column}"`;
  const val = escapeSource(String(filter.value));

  if (filter.operator === 'LIKE') {
    return `CAST(${col} AS VARCHAR) ILIKE '%${val}%'`;
  }
  if (ALLOWED_UNARY_OPS.has(filter.operator)) {
    return `${col} ${filter.operator}`;
  }
  if (ALLOWED_BINARY_OPS.has(filter.operator)) {
    return `${col} ${filter.operator} '${val}'`;
  }
  // Reject unknown operators — never interpolate arbitrary strings into SQL.
  throw new Error(`Invalid filter operator: ${filter.operator}`);
}
