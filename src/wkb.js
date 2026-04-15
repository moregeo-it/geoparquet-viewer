/**
 * WKB (Well-Known Binary) to GeoJSON geometry converter.
 *
 * Supports: Point, LineString, Polygon, MultiPoint,
 * MultiLineString, MultiPolygon, GeometryCollection.
 * Handles Z/M coordinates and both byte orderings.
 */

/**
 * Convert a WKB buffer to a GeoJSON geometry object.
 * @param {Uint8Array|ArrayBuffer} wkb - The WKB binary data.
 * @returns {object} GeoJSON geometry object.
 */
export function wkbToGeoJSON(wkb) {
  let buffer;
  if (wkb instanceof ArrayBuffer) {
    buffer = wkb;
  } else if (ArrayBuffer.isView(wkb)) {
    buffer = wkb.buffer.slice(wkb.byteOffset, wkb.byteOffset + wkb.byteLength);
  } else {
    throw new Error('Invalid WKB input: expected ArrayBuffer or TypedArray');
  }

  const view = new DataView(buffer);
  const result = readGeometry(view, 0);
  return result.geometry;
}

function readGeometry(view, offset) {
  const byteOrder = view.getUint8(offset);
  offset += 1;
  const le = byteOrder === 1;

  let wkbType = view.getUint32(offset, le);
  offset += 4;

  let hasZ = false;
  let hasM = false;

  // ISO WKB type ranges
  if (wkbType >= 3000 && wkbType < 4000) {
    hasZ = true;
    hasM = true;
    wkbType -= 3000;
  } else if (wkbType >= 2000 && wkbType < 3000) {
    hasM = true;
    wkbType -= 2000;
  } else if (wkbType >= 1000 && wkbType < 2000) {
    hasZ = true;
    wkbType -= 1000;
  }

  // EWKB flags
  if (wkbType & 0x80000000) {
    hasZ = true;
    wkbType &= ~0x80000000;
  }
  if (wkbType & 0x40000000) {
    hasM = true;
    wkbType &= ~0x40000000;
  }
  const hasSRID = (wkbType & 0x20000000) !== 0;
  wkbType &= ~0x20000000;

  // Skip SRID if present
  if (hasSRID) {
    offset += 4;
  }

  const dims = 2 + (hasZ ? 1 : 0) + (hasM ? 1 : 0);

  function readCoord() {
    const c = [view.getFloat64(offset, le), view.getFloat64(offset + 8, le)];
    if (hasZ) c.push(view.getFloat64(offset + 16, le));
    offset += dims * 8;
    return c;
  }

  function readCoords(n) {
    const coords = [];
    for (let i = 0; i < n; i++) coords.push(readCoord());
    return coords;
  }

  function readLinearRing() {
    const n = view.getUint32(offset, le);
    offset += 4;
    return readCoords(n);
  }

  let geometry;

  switch (wkbType) {
    case 1: {
      // Point
      geometry = { type: 'Point', coordinates: readCoord() };
      break;
    }
    case 2: {
      // LineString
      const n = view.getUint32(offset, le);
      offset += 4;
      geometry = { type: 'LineString', coordinates: readCoords(n) };
      break;
    }
    case 3: {
      // Polygon
      const nRings = view.getUint32(offset, le);
      offset += 4;
      const rings = [];
      for (let i = 0; i < nRings; i++) rings.push(readLinearRing());
      geometry = { type: 'Polygon', coordinates: rings };
      break;
    }
    case 4: {
      // MultiPoint
      const n = view.getUint32(offset, le);
      offset += 4;
      const points = [];
      for (let i = 0; i < n; i++) {
        const sub = readGeometry(view, offset);
        points.push(sub.geometry.coordinates);
        offset = sub.offset;
      }
      geometry = { type: 'MultiPoint', coordinates: points };
      break;
    }
    case 5: {
      // MultiLineString
      const n = view.getUint32(offset, le);
      offset += 4;
      const lines = [];
      for (let i = 0; i < n; i++) {
        const sub = readGeometry(view, offset);
        lines.push(sub.geometry.coordinates);
        offset = sub.offset;
      }
      geometry = { type: 'MultiLineString', coordinates: lines };
      break;
    }
    case 6: {
      // MultiPolygon
      const n = view.getUint32(offset, le);
      offset += 4;
      const polys = [];
      for (let i = 0; i < n; i++) {
        const sub = readGeometry(view, offset);
        polys.push(sub.geometry.coordinates);
        offset = sub.offset;
      }
      geometry = { type: 'MultiPolygon', coordinates: polys };
      break;
    }
    case 7: {
      // GeometryCollection
      const n = view.getUint32(offset, le);
      offset += 4;
      const geoms = [];
      for (let i = 0; i < n; i++) {
        const sub = readGeometry(view, offset);
        geoms.push(sub.geometry);
        offset = sub.offset;
      }
      geometry = { type: 'GeometryCollection', geometries: geoms };
      break;
    }
    default:
      throw new Error(`Unsupported WKB geometry type: ${wkbType}`);
  }

  return { geometry, offset };
}

// ─── Bounds computation ───────────────────────────────────────────────────────

/**
 * Compute a bounding box [[west, south], [east, north]] from GeoJSON features.
 */
export function computeBounds(features) {
  let west = Infinity, south = Infinity, east = -Infinity, north = -Infinity;

  for (const feature of features) {
    visitCoords(feature.geometry, (lon, lat) => {
      if (lon < west) west = lon;
      if (lat < south) south = lat;
      if (lon > east) east = lon;
      if (lat > north) north = lat;
    });
  }

  if (!isFinite(west)) return null;
  return [[west, south], [east, north]];
}

function visitCoords(geometry, callback) {
  if (!geometry) return;
  switch (geometry.type) {
    case 'Point':
      callback(geometry.coordinates[0], geometry.coordinates[1]);
      break;
    case 'MultiPoint':
    case 'LineString':
      for (const coord of geometry.coordinates) callback(coord[0], coord[1]);
      break;
    case 'MultiLineString':
    case 'Polygon':
      for (const ring of geometry.coordinates)
        for (const coord of ring) callback(coord[0], coord[1]);
      break;
    case 'MultiPolygon':
      for (const poly of geometry.coordinates)
        for (const ring of poly)
          for (const coord of ring) callback(coord[0], coord[1]);
      break;
    case 'GeometryCollection':
      for (const geom of geometry.geometries) visitCoords(geom, callback);
      break;
  }
}
