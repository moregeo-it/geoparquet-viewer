/**
 * Conversion controller (main thread)
 *
 * Spawns the converter worker, forwards a conversion request, streams status
 * updates back to the caller, and triggers the file download when done.
 * Cancellation is implemented by terminating the worker.
 */
import ConverterWorker from './converter.worker.js?worker';

export const FORMATS = [
  {
    id: 'geojson',
    label: 'GeoJSON (FeatureCollection, EPSG:4326)',
    ext: 'geojson',
    geoCapable: true,
    requiresGeo: true
  },
  { id: 'csv', label: 'CSV (geometry as WKT EPSG:4326)', ext: 'csv', geoCapable: false },
  { id: 'json', label: 'NDJSON (geometry as WKT EPSG:4326)', ext: 'ndjson', geoCapable: false }
];

/**
 * Start a conversion. Returns a handle with `cancel()` and `promise`.
 *
 * @param {Object} opts
 * @param {string} opts.source - Source identifier (URL or registered file name).
 * @param {ArrayBuffer|null} opts.sourceBuffer - Local file buffer (when source is local).
 * @param {string} opts.format - Target format id.
 * @param {string} opts.outputName - Suggested output filename (without extension).
 * @param {Array} opts.schema - Schema columns ({name, type, ...}).
 * @param {Array<string>} opts.geoColumns - Names of geometry columns.
 * @param {string|null} opts.primaryGeoColumn - Primary geometry column name.
 * @param {string|null} opts.sourceCrs - Source CRS as PROJJSON string (null = WGS84).
 * @param {Function} opts.onStatus - status(message) callback.
 * @returns {{ promise: Promise<{filename:string}>, cancel: Function }}
 */
export function startConversion({
  source,
  sourceBuffer = null,
  format,
  outputName,
  schema,
  geoColumns = [],
  primaryGeoColumn = null,
  sourceCrs = null,
  onStatus = () => {}
}) {
  const worker = new ConverterWorker();
  let cancelled = false;
  let rejectFn;

  const promise = new Promise((resolve, reject) => {
    rejectFn = reject;
    worker.onmessage = (ev) => {
      const m = ev.data;
      if (!m) return;
      if (m.type === 'status') {
        onStatus(m.message);
      } else if (m.type === 'done') {
        try {
          const blob = new Blob([m.buffer], { type: m.mime });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          const filename = `${outputName}.${m.ext}`;
          a.href = url;
          a.download = filename;
          document.body.appendChild(a);
          a.click();
          a.remove();
          // Revoke later to give the browser time to start the download.
          setTimeout(() => URL.revokeObjectURL(url), 60_000);
          worker.terminate();
          resolve({ filename });
        } catch (e) {
          worker.terminate();
          reject(e);
        }
      } else if (m.type === 'error') {
        worker.terminate();
        reject(new Error(m.error));
      }
    };
    worker.onerror = (e) => {
      if (cancelled) return;
      worker.terminate();
      reject(new Error(e?.message || 'Worker error'));
    };

    // Strip Vue reactive Proxies before structured-cloning into the worker.
    // JSON round-trip is the simplest way to get plain serializable values.
    const plainSchema = JSON.parse(JSON.stringify(schema ?? []));
    const plainGeoColumns = JSON.parse(JSON.stringify(geoColumns ?? []));

    // Fire the request. Transfer the buffer when present to avoid a copy.
    const transfer = sourceBuffer ? [sourceBuffer] : [];
    worker.postMessage(
      {
        type: 'convert',
        source,
        sourceBuffer,
        sourceName: sourceBuffer ? `convert_src_${Date.now()}.parquet` : null,
        format,
        schema: plainSchema,
        geoColumns: plainGeoColumns,
        primaryGeoColumn,
        sourceCrs
      },
      transfer
    );
  });

  return {
    promise,
    cancel() {
      if (cancelled) return;
      cancelled = true;
      worker.terminate();
      rejectFn(new DOMException('Conversion cancelled', 'AbortError'));
    }
  };
}
