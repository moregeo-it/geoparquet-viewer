import { formatValue } from '@walkthru-earth/objex-utils';

// Default number of rows to load per page. This is a tradeoff between loading speed and interactivity.
export const DEFAULT_PAGE_SIZE = 10000;

// Files should be partitioned when larger than 2 GB according to
// https://github.com/opengeospatial/geoparquet/blob/main/format-specs/distributing-geoparquet.md
// Give some additional leeway and use 5 GB, which would be 3 files and where it makes sense to actually split files.
// Partionioning inconvenience into just two files seems not always worth.
const MAX_REC_FILE_SIZE = 5 * 1024 * 1024 * 1024;

// There's no specific best practice, but performnce degrades when the footer is too small.
// It's an indication for too small row groups when the data is pretty large.
const MAX_REC_FOOTER_SIZE = 10 * 1024 * 1024; // 10 MB

/**
 * General utilities
 *
 * @class
 */
export default class Utils {
  /**
   * Checks whether a variable is a real object or not.
   *
   * This is a more strict version of `typeof x === 'object'` as this example would also succeeds for arrays and `null`.
   * This function only returns `true` for real objects and not for arrays, `null` or any other data types.
   *
   * @param {*} obj - A variable to check.
   * @returns {boolean} - `true` is the given variable is an object, `false` otherwise.
   */
  static isObject(obj) {
    return typeof obj === 'object' && obj === Object(obj) && !Array.isArray(obj);
  }

  static formatBytes(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  }

  static normalizeDisplayValue(value) {
    if (value === null || value === undefined) return value;
    if (ArrayBuffer.isView(value)) return `[binary ${value.byteLength}B]`;
    return formatValue(value);
  }

  /**
   * Parse all shareable state from the current URL.
   * Called once on mount — single source of truth for URL → app state.
   *
   * Supported query parameters:
   *  - `url`      — Remote Parquet file URL.
   *  - `c`        — Column name (repeatable).
   *  - `pageSize` — Positive integer, rows per page.
   *  - `map`      — Camera position as `zoom~lat~lng` (tilde-separated).
   *  - `bbox`     — Spatial filter as `west~south~east~north` (WGS 84, tilde-separated).
   *
   * Compound values use `~` as separator to avoid URL-encoding issues with commas.
   *
   * @returns {{url: string|null, columns: string[]|null, pageSize: number|null, center: [number,number]|null, zoom: number|null, bbox: number[]|null}}
   *   Frozen object — properties are null when the parameter is absent or invalid.
   */
  static parseUrlState() {
    const p = new URLSearchParams(window.location.search);
    const pageSizeParam = p.get('pageSize');
    const mapParam = p.get('map');

    const columns = p.getAll('c').filter(Boolean);
    const rawPageSize = pageSizeParam ? parseInt(pageSizeParam, 10) : null;

    let center = null;
    let zoom = null;
    if (mapParam) {
      const parts = mapParam.split('~').map(Number);
      if (parts.length === 3 && parts.every(Number.isFinite)) {
        zoom = parts[0];
        center = [parts[1], parts[2]];
      }
    }

    let bbox = null;
    const bboxParam = p.get('bbox');
    if (bboxParam) {
      const parts = bboxParam.split('~').map(Number);
      if (parts.length === 4 && parts.every(Number.isFinite)) {
        bbox = parts;
      }
    }

    return Object.freeze({
      url: p.get('url') || null,
      columns: columns.length > 0 ? columns : null,
      pageSize: Number.isFinite(rawPageSize) && rawPageSize > 0 ? rawPageSize : null,
      center,
      zoom,
      bbox
    });
  }

  /**
   * Write shareable state to URL via `history.replaceState` (no navigation, no history entry).
   * Only non-default values are written; if `url` is falsy the query string is cleared entirely.
   *
   * @param {object} state
   * @param {string|null} state.url - Remote file URL. When null/empty, all params are removed.
   * @param {string[]|null} state.columns - Selected display columns.
   * @param {number|null} state.pageSize - Rows per page (omitted when default).
   * @param {[number, number]|null} state.center - Map center as [lat, lng].
   * @param {number|null} state.zoom - Map zoom level.
   * @param {number[]|null} state.bbox - Spatial filter [west, south, east, north] in WGS 84.
   * @param {string|null} state.geoColumn - Primary geometry column name (prepended to `c` list).
   */
  static syncUrlParams({ url, columns, pageSize, center, zoom, bbox }) {
    if (!url) {
      history.replaceState({}, '', window.location.pathname);
      return;
    }
    const p = new URLSearchParams();
    p.set('url', url);
    if (Array.isArray(columns)) {
      columns.forEach((col) => p.append('c', col));
    }
    if (pageSize && pageSize !== null) p.set('pageSize', String(pageSize));
    if (center && zoom != null) {
      p.set('map', `${zoom.toFixed(2)}~${center[0].toFixed(5)}~${center[1].toFixed(5)}`);
    }
    if (bbox && bbox.length === 4) {
      p.set('bbox', bbox.map((v) => v.toFixed(6)).join('~'));
    }
    history.replaceState({}, '', `?${p.toString()}`);
  }

  static friendlyError(err) {
    const msg = err?.message || String(err);

    if (/malloc.*failed|out of memory|memory allocation/i.test(msg)) {
      return {
        title: 'Out of memory',
        detail: 'The browser ran out of memory while processing this file.',
        suggestion:
          'Try loading fewer rows per page in Settings, selecting fewer columns, or filtering by viewport.'
      };
    }
    if (/fetch|networkerror|failed to fetch|ERR_CONNECTION/i.test(msg)) {
      return {
        title: 'Network error',
        detail:
          'Could not download the file. The server may be unreachable or the URL may be incorrect.',
        suggestion: 'Check the URL and your internet connection, then try again.'
      };
    }
    if (/CORS|blocked by|access-control-allow-origin/i.test(msg)) {
      return {
        title: 'Blocked by CORS',
        detail: 'The remote server does not allow cross-origin requests from this page.',
        suggestion: 'Download the file locally and load it from disk, or use a CORS-enabled host.'
      };
    }
    if (/not a parquet|magic bytes|invalid parquet|invalid thrift/i.test(msg)) {
      return {
        title: 'Invalid file',
        detail: 'The file does not appear to be a valid Parquet file.',
        suggestion: 'Make sure you are loading a .parquet or .geoparquet file.'
      };
    }
    if (/range request|content-range|HTTP 416/i.test(msg)) {
      return {
        title: 'Range requests not supported',
        detail:
          'The server does not support HTTP range requests, which are required for remote Parquet files.',
        suggestion:
          'Download the file locally, or host it on a server that supports range requests (e.g. S3, GCS).'
      };
    }
    if (/HTTP 4\d\d|HTTP 5\d\d|403|404|500/i.test(msg)) {
      const code = msg.match(/\b(4\d\d|5\d\d)\b/)?.[0];
      return {
        title: `Server error${code ? ' (' + code + ')' : ''}`,
        detail: 'The server returned an error while fetching the file.',
        suggestion: 'Check that the URL is correct and the file is publicly accessible.'
      };
    }
    if (/_setThrew|stoi.*no conversion/i.test(msg)) {
      return {
        title: 'Spatial extension error',
        detail:
          "DuckDB's spatial extension encountered an internal error, possibly due to an unsupported CRS.",
        suggestion:
          'This is a known DuckDB-WASM limitation. Try a file with WGS 84 (EPSG:4326) coordinates.'
      };
    }
    // Generic fallback
    return {
      title: 'Error',
      detail: msg,
      suggestion: null
    };
  }
}

/**
 * Pre-DuckDB health check for remote Parquet files.
 * Reads only the last 8 bytes via HTTP Range request to determine footer size
 * and file size without downloading any actual data.
 *
 * @param {string} url - Remote URL of the Parquet file.
 * @param {object} [options]
 * @param {number} [options.timeout=5000] - Abort if fetch takes longer (ms).
 * @returns {Promise<Array<object>>} Array of warning objects (empty = no issues).
 */
export async function checkFileHealth(url, { timeout = 5000 } = {}) {
  const warnings = [];
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  try {
    const resp = await fetch(url, {
      method: 'GET',
      headers: { Range: 'bytes=-8' },
      signal: controller.signal
    });
    clearTimeout(timer);

    if (resp.status !== 206) return warnings;

    // Parse file size from Content-Range header
    let fileSize = null;
    const contentRange = resp.headers.get('Content-Range');
    if (contentRange) {
      const match = contentRange.match(/\/(\d+)$/);
      if (match) fileSize = parseInt(match[1], 10);
    }

    // Read footer length (4 bytes LE) + validate PAR1 magic
    const buf = await resp.arrayBuffer();
    if (buf.byteLength < 8 || buf.byteLength > 8) return warnings;

    const magic = new Uint8Array(buf, 4, 4);
    if (magic[0] !== 0x50 || magic[1] !== 0x41 || magic[2] !== 0x52 || magic[3] !== 0x31) {
      return warnings; // Not a valid Parquet file — let DuckDB handle the error later
    }

    const footerSize = new DataView(buf).getUint32(0, true);

    if (footerSize > MAX_REC_FOOTER_SIZE) {
      warnings.push({
        icon: 'mdi-file-outline',
        title: `Large Parquet footer (${Utils.formatBytes(footerSize)})`,
        detail:
          'The footer size is large. The initial loading may be slow while reading the schema and metadata.\nA large footer may result from a large number of columns or that the row groups in comparison to the overall files size are too small.'
      });
    }

    if (fileSize && fileSize > MAX_REC_FILE_SIZE) {
      warnings.push({
        icon: 'mdi-harddisk',
        title: `Very large file (${Utils.formatBytes(fileSize)})`,
        detail:
          'The file size exceeds the recommended maximum by far. Data may load fine, but you likely can not load the entire file.\nTry selecting fewer columns or filter by map viewport.\nThe Parquet file should ideally be partitioned into multiple files.'
      });
    }
  } catch {
    clearTimeout(timer);
    // Health check is best-effort — don't block loading on failure.
  }
  return warnings;
}
