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

    if (footerSize > 1 * 1024 * 1024) {
      warnings.push({
        icon: 'mdi-file-outline',
        title: `Large Parquet footer (${(footerSize / 1024 / 1024).toFixed(1)} MB)`,
        detail:
          'Reading the schema and metadata will require downloading the entire footer — this may take a while.'
      });
    }

    if (fileSize && fileSize > 5 * 1024 * 1024 * 1024) {
      warnings.push({
        icon: 'mdi-harddisk',
        title: `Very large file (${(fileSize / 1024 / 1024 / 1024).toFixed(1)} GB)`,
        detail:
          'Queries may require significant downloads. Consider using viewport filtering to load only visible data.'
      });
    }
  } catch {
    clearTimeout(timer);
    // Health check is best-effort — don't block loading on failure.
  }
  return warnings;
}

/**
 * Map raw DuckDB/WASM/network errors to user-friendly messages.
 * Returns { title, detail, suggestion }.
 */
export function friendlyError(err) {
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
