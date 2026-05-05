import { formatValue } from '@walkthru-earth/objex-utils';

export const DEFAULT_PAGE_SIZE = 10000;

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

  static normalizeDisplayValue(value) {
    if (value === null || value === undefined) return value;
    if (ArrayBuffer.isView(value)) return `[binary ${value.byteLength}B]`;
    return formatValue(value);
  }

  /**
   * Parse all shareable state from the current URL.
   * Called once on mount — single source of truth for URL → app state.
   */
  static parseUrlState() {
    const p = new URLSearchParams(window.location.search);
    const colsParam = p.get('columns');
    const pageSizeParam = p.get('pageSize');
    const mapParam = p.get('map');

    const columns = colsParam ? colsParam.split(',').filter(Boolean) : null;
    const rawPageSize = pageSizeParam ? parseInt(pageSizeParam, 10) : null;

    let center = null;
    let zoom = null;
    if (mapParam) {
      const parts = mapParam.split('/').map(Number);
      if (parts.length === 3 && parts.every(Number.isFinite)) {
        zoom = parts[0];
        center = [parts[1], parts[2]];
      }
    }

    return Object.freeze({
      url: p.get('url') || null,
      columns: columns && columns.length > 0 ? columns : null,
      pageSize: Number.isFinite(rawPageSize) && rawPageSize > 0 ? rawPageSize : null,
      center,
      zoom,
      viewportFilter: p.get('viewport') === '1'
    });
  }

  /**
   * Write shareable state to URL (replaceState — no navigation, no history entry).
   * Only non-default values are written.
   */
  static syncUrlParams({ url, columns, pageSize, center, zoom, viewportFilter }) {
    const p = new URLSearchParams();
    if (url) p.set('url', url);
    if (columns && columns.length > 0) p.set('columns', columns.join(','));
    if (pageSize && pageSize !== DEFAULT_PAGE_SIZE) p.set('pageSize', String(pageSize));
    if (center && zoom != null) {
      p.set('map', `${zoom.toFixed(2)}/${center[0].toFixed(5)}/${center[1].toFixed(5)}`);
    }
    if (viewportFilter) p.set('viewport', '1');
    const qs = p.toString();
    history.replaceState({}, '', qs ? `?${qs}` : window.location.pathname);
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
