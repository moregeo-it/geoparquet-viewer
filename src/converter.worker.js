/**
 * Conversion Worker
 *
 * Runs an isolated DuckDB-WASM instance off the main thread to convert the
 * currently loaded Parquet source into a different file format (CSV, NDJSON,
 * or GeoJSON) using DuckDB's COPY statement.
 *
 * The conversion runs end-to-end in this worker. Progress is communicated via
 * `status` messages (we don't have row-level progress for single-shot COPY,
 * but stage messages give the user a sense of where things stand). The host
 * cancels by terminating the worker.
 */
import * as duckdb from '@duckdb/duckdb-wasm';
import duckdb_wasm_eh from '@duckdb/duckdb-wasm/dist/duckdb-eh.wasm?url';
import duckdb_worker_eh from '@duckdb/duckdb-wasm/dist/duckdb-browser-eh.worker.js?url';

let _db = null;
let _conn = null;
let _initPromise = null;
let _spatialLoaded = false;

function post(msg, transfer) {
  self.postMessage(msg, transfer || []);
}

function status(message) {
  post({ type: 'status', message });
}

function escSrc(s) {
  return String(s).replace(/'/g, "''");
}

function quoteIdent(name) {
  return `"${String(name).replace(/"/g, '""')}"`;
}

async function init() {
  if (_db) return;
  if (_initPromise) return _initPromise;

  _initPromise = (async () => {
    status('Starting DuckDB...');
    const innerWorker = new Worker(duckdb_worker_eh);
    const logger = new duckdb.ConsoleLogger(duckdb.LogLevel.WARNING);
    _db = new duckdb.AsyncDuckDB(logger, innerWorker);
    await _db.instantiate(duckdb_wasm_eh);

    try {
      await _db.open({ query: { castBigIntToDouble: true } });
    } catch {
      await _db.open({});
    }
    _conn = await _db.connect();

    status('Loading extensions...');
    try {
      await _conn.query(`INSTALL httpfs`);
      await _conn.query(`LOAD httpfs`);
    } catch (e) {
      console.warn('[convert worker] httpfs unavailable:', e?.message);
    }
    try {
      await _conn.query(`INSTALL spatial`);
      await _conn.query(`LOAD spatial`);
      _spatialLoaded = true;
    } catch (e) {
      console.warn('[convert worker] spatial unavailable:', e?.message);
    }
  })();

  return _initPromise;
}

async function detectAlreadyGeometry(escaped, geoColumn) {
  if (!geoColumn || !_spatialLoaded) return false;
  try {
    const r = await _conn.query(`DESCRIBE SELECT * FROM read_parquet('${escaped}')`);
    for (const row of r.toArray()) {
      if (String(row.column_name) === geoColumn) {
        return String(row.column_type).toUpperCase().startsWith('GEOMETRY');
      }
    }
  } catch {
    /* ignore */
  }
  return false;
}

self.onmessage = async (ev) => {
  const msg = ev.data;
  if (!msg || msg.type !== 'convert') return;
  try {
    await convert(msg);
  } catch (e) {
    console.error('[convert worker] error:', e);
    post({ type: 'error', error: e?.message || String(e) });
  }
};

async function convert({
  source,
  sourceBuffer,
  sourceName,
  format,
  schema,
  geoColumns = [],
  primaryGeoColumn = null,
  sourceCrs = null
}) {
  await init();

  // Resolve source: either a registered local buffer or a remote URL.
  let src;
  if (sourceBuffer) {
    status('Registering source file...');
    await _db.registerFileBuffer(sourceName, new Uint8Array(sourceBuffer));
    src = sourceName;
  } else {
    src = source;
  }
  const escaped = escSrc(src);

  if (primaryGeoColumn && !_spatialLoaded) {
    throw new Error(
      'Spatial extension is not available in the conversion worker. ' +
        'Geometry-aware export requires the DuckDB spatial extension.'
    );
  }

  const alreadyGeometry = await detectAlreadyGeometry(escaped, primaryGeoColumn);

  // Build a GEOMETRY-typed expression in EPSG:4326 for the primary geometry.
  let geomExpr = null;
  if (primaryGeoColumn) {
    const base = alreadyGeometry
      ? quoteIdent(primaryGeoColumn)
      : `ST_GeomFromWKB(${quoteIdent(primaryGeoColumn)})`;
    if (sourceCrs) {
      const lit = sourceCrs.replace(/'/g, "''");
      geomExpr = `ST_Transform(${base}, '${lit}', 'EPSG:4326', true)`;
    } else {
      geomExpr = base;
    }
  }

  // Property columns = all schema columns minus geometry columns and internal.
  const propCols = (schema || [])
    .map((c) => c.name)
    .filter((n) => !geoColumns.includes(n) && !String(n).startsWith('__'));

  const outFile = '/__convert_out';
  let result;

  switch (format) {
    case 'csv':
      result = await exportCsv({ escaped, primaryGeoColumn, geomExpr, outFile });
      break;
    case 'json':
      result = await exportNdjson({ escaped, primaryGeoColumn, geomExpr, outFile });
      break;
    case 'geojson':
      result = await exportGeoJson({
        escaped,
        primaryGeoColumn,
        geomExpr,
        propCols,
        outFile
      });
      break;
    default:
      throw new Error(`Unsupported format: ${format}`);
  }

  // Cleanup registered source buffer (if any).
  if (sourceBuffer) {
    try {
      await _db.dropFile(sourceName);
    } catch {
      /* ignore */
    }
  }

  // Transfer the underlying ArrayBuffer without copying when the view already
  // spans the full buffer; otherwise fall back to slicing so the host still
  // receives exactly the exported bytes.
  const view = result.buffer;
  const backing = view.buffer;
  const ab =
    view.byteOffset === 0 && view.byteLength === backing.byteLength
      ? backing
      : backing.slice(view.byteOffset, view.byteOffset + view.byteLength);
  post({ type: 'done', buffer: ab, mime: result.mime, ext: result.ext }, [ab]);
}

async function copyAndRead(copySql, outFile) {
  status('Converting (this may take a while)...');
  await _conn.query(copySql);
  status('Reading output...');
  const buf = await _db.copyFileToBuffer(outFile);
  try {
    await _db.dropFile(outFile);
  } catch {
    /* ignore */
  }
  return buf;
}

async function exportCsv({ escaped, primaryGeoColumn, geomExpr, outFile }) {
  const replace = primaryGeoColumn
    ? ` REPLACE (ST_AsText(${geomExpr}) AS ${quoteIdent(primaryGeoColumn)})`
    : '';
  const inner = `SELECT *${replace} FROM read_parquet('${escaped}')`;
  const sql = `COPY (${inner}) TO '${outFile}' (FORMAT CSV, HEADER true)`;
  const buf = await copyAndRead(sql, outFile);
  return { buffer: buf, mime: 'text/csv', ext: 'csv' };
}

async function exportNdjson({ escaped, primaryGeoColumn, geomExpr, outFile }) {
  const replace = primaryGeoColumn
    ? ` REPLACE (ST_AsText(${geomExpr}) AS ${quoteIdent(primaryGeoColumn)})`
    : '';
  const inner = `SELECT *${replace} FROM read_parquet('${escaped}')`;
  const sql = `COPY (${inner}) TO '${outFile}' (FORMAT JSON, ARRAY false)`;
  const buf = await copyAndRead(sql, outFile);
  return { buffer: buf, mime: 'application/x-ndjson', ext: 'ndjson' };
}

async function exportGeoJson({ escaped, primaryGeoColumn, geomExpr, propCols, outFile }) {
  if (!primaryGeoColumn) {
    throw new Error('GeoJSON export requires a geometry column.');
  }
  const propsExpr =
    propCols.length > 0
      ? `struct_pack(${propCols.map((c) => `${quoteIdent(c)} := ${quoteIdent(c)}`).join(', ')})`
      : `NULL`;
  const inner =
    `SELECT 'Feature' AS type,` +
    ` CAST(ST_AsGeoJSON(${geomExpr}) AS JSON) AS geometry,` +
    ` ${propsExpr} AS properties` +
    ` FROM read_parquet('${escaped}')`;
  const sql = `COPY (${inner}) TO '${outFile}' (FORMAT JSON, ARRAY true)`;

  status('Converting (this may take a while)...');
  await _conn.query(sql);
  status('Reading output...');
  const features = await _db.copyFileToBuffer(outFile);
  try {
    await _db.dropFile(outFile);
  } catch {
    /* ignore */
  }

  const header = new TextEncoder().encode('{"type":"FeatureCollection","features":');
  const footer = new TextEncoder().encode('}');
  const out = new Uint8Array(header.length + features.length + footer.length);
  out.set(header, 0);
  out.set(features, header.length);
  out.set(footer, header.length + features.length);
  return { buffer: out, mime: 'application/geo+json', ext: 'geojson' };
}
