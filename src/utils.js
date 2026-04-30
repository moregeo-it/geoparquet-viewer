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
