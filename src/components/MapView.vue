<template>
  <div ref="mapContainer" class="map-container">
    <button
      v-if="viewportStale"
      class="reload-viewport-btn"
      :disabled="loading"
      @click="$emit('reloadViewport')"
    >
      Reload viewport
    </button>
  </div>
</template>

<script>
import maplibregl from 'maplibre-gl';
import { MapboxOverlay } from '@deck.gl/mapbox';
import {
  GeoArrowPathLayer,
  GeoArrowPolygonLayer,
  GeoArrowScatterplotLayer
} from '@geoarrow/deck.gl-layers';
import { parseWKB } from '@walkthru-earth/objex-utils';

const NORMAL_FILL = [51, 153, 204, 120];
const NORMAL_LINE = [51, 153, 204, 200];

// Selection colors per theme (must stay in sync with TableView CSS)
const SELECTED_FILL_LIGHT = [255, 152, 0, 160];
const SELECTED_LINE_LIGHT = [230, 120, 0, 255];
const SELECTED_FILL_DARK = [255, 183, 77, 180];
const SELECTED_LINE_DARK = [255, 160, 0, 255];

export default {
  name: 'MapView',
  props: {
    geoArrowResults: { type: Array, default: () => [] },
    selectedIndex: { type: Number, default: null },
    bounds: { type: Array, default: null },
    wkbByIndex: { type: Object, default: () => ({}) },
    viewportStale: { type: Boolean, default: false },
    loading: { type: Boolean, default: false },
    isDark: { type: Boolean, default: false },
    bbox: { type: Array, default: null },
    initialCenter: { type: Array, default: null },
    initialZoom: { type: Number, default: null },
    skipInitialFit: { type: Boolean, default: false }
  },
  emits: ['select', 'viewportChange', 'reloadViewport'],
  data() {
    return {
      map: null,
      overlay: null,
      ready: false,
      moveEndTimer: null,
      hasFittedOnce: false
    };
  },
  created() {
    // Non-reactive cache for lazily computed feature bounds.
    this.geoBoundsCache = {};
  },
  watch: {
    geoArrowResults: {
      handler() {
        this.updateLayers();
      }
    },
    selectedIndex() {
      this.updateLayers();
    },
    isDark() {
      this.updateLayers();
    },
    bounds() {
      this.fitBounds();
    },
    bbox: {
      handler() {
        this.updateBboxLayer();
      }
    }
  },
  mounted() {
    this.createMap();
  },
  beforeUnmount() {
    if (this.map) {
      this.map.remove();
      this.map = null;
    }
  },
  methods: {
    rowIndex(row) {
      if (!row) return null;
      const value = row.__index;
      if (typeof value === 'number' && isFinite(value)) return value;
      if (typeof value === 'bigint') return Number(value);
      return null;
    },

    createMap() {
      this.map = new maplibregl.Map({
        container: this.$refs.mapContainer,
        style: {
          version: 8,
          sources: {
            osm: {
              type: 'raster',
              tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
              tileSize: 256,
              attribution:
                '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            }
          },
          layers: [
            {
              id: 'osm',
              type: 'raster',
              source: 'osm',
              minzoom: 0,
              maxzoom: 19
            }
          ]
        },
        center: this.initialCenter || [0, 20],
        zoom: this.initialZoom ?? 2,
        attributionControl: true
      });

      this.map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');

      this.overlay = new MapboxOverlay({ layers: [], interleaved: false });
      this.map.addControl(this.overlay);

      this.map.on('load', () => {
        this.ready = true;
        this.updateLayers();
        this.updateBboxLayer();
        if (this.bounds) this.fitBounds();
        // Emit initial viewport so App can trigger viewport-filtered loading
        this.emitViewport();
      });

      // Emit viewport bounds on pan/zoom (debounced 400 ms)
      this.map.on('moveend', (event) => {
        if (event.automated) return;
        if (this.moveEndTimer) clearTimeout(this.moveEndTimer);
        this.moveEndTimer = setTimeout(() => this.emitViewport(), 400);
      });
    },

    emitViewport() {
      if (!this.map) return;
      const b = this.map.getBounds();
      const center = this.map.getCenter();
      const zoom = this.map.getZoom();
      this.$emit('viewportChange', {
        bbox: [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()],
        center: [center.lng, center.lat],
        zoom
      });
    },

    updateLayers() {
      if (!this.overlay || !this.ready) return;

      const layers = [];
      if (this.geoArrowResults.length > 0) {
        const selectedIndex = this.selectedIndex;
        const SELECTED_FILL = this.isDark ? SELECTED_FILL_DARK : SELECTED_FILL_LIGHT;
        const SELECTED_LINE = this.isDark ? SELECTED_LINE_DARK : SELECTED_LINE_LIGHT;
        const emitSelectFromInfo = (info) => {
          const index = this.rowIndex(info?.object);
          if (index === null) return;
          this.$emit('select', index === selectedIndex ? null : index);
        };

        for (let i = 0; i < this.geoArrowResults.length; i++) {
          const result = this.geoArrowResults[i];
          const layerId = `geoarrow-${result.geometryType}-${i}`;

          // Extract __index column values for selection lookup in accessors.
          // GeoArrow accessor functions receive { index, data, target }, not row objects.
          const indexCol = result.table.getChild('__index');
          const indexValues = indexCol ? indexCol.toArray() : null;
          const isSelected = (objectInfo) =>
            selectedIndex !== null &&
            indexValues !== null &&
            indexValues[objectInfo.index] === selectedIndex;

          if (result.geometryType === 'point' || result.geometryType === 'multipoint') {
            layers.push(
              new GeoArrowScatterplotLayer({
                id: layerId,
                data: result.table,
                getFillColor: (objectInfo) =>
                  isSelected(objectInfo) ? SELECTED_FILL : NORMAL_FILL,
                getRadius: 6,
                radiusUnits: 'pixels',
                radiusMinPixels: 4,
                radiusMaxPixels: 12,
                pickable: true,
                autoHighlight: true,
                highlightColor: [255, 200, 0, 160],
                _validate: false,
                onHover: (info) => {
                  if (this.map) {
                    this.map.getCanvas().style.cursor = info.object ? 'pointer' : '';
                  }
                },
                onClick: emitSelectFromInfo,
                updateTriggers: {
                  getFillColor: [selectedIndex, this.isDark]
                }
              })
            );
          } else if (
            result.geometryType === 'linestring' ||
            result.geometryType === 'multilinestring'
          ) {
            layers.push(
              new GeoArrowPathLayer({
                id: layerId,
                data: result.table,
                getColor: (objectInfo) => (isSelected(objectInfo) ? SELECTED_LINE : NORMAL_LINE),
                getWidth: 2.5,
                widthUnits: 'pixels',
                widthMinPixels: 1.5,
                pickable: true,
                autoHighlight: true,
                highlightColor: [255, 200, 0, 160],
                _validate: false,
                onHover: (info) => {
                  if (this.map) {
                    this.map.getCanvas().style.cursor = info.object ? 'pointer' : '';
                  }
                },
                onClick: emitSelectFromInfo,
                updateTriggers: {
                  getColor: [selectedIndex, this.isDark]
                }
              })
            );
          } else {
            layers.push(
              new GeoArrowPolygonLayer({
                id: layerId,
                data: result.table,
                getFillColor: (objectInfo) =>
                  isSelected(objectInfo) ? SELECTED_FILL : NORMAL_FILL,
                getLineColor: (objectInfo) =>
                  isSelected(objectInfo) ? SELECTED_LINE : NORMAL_LINE,
                getLineWidth: 2,
                lineWidthMinPixels: 1.5,
                pickable: true,
                autoHighlight: true,
                highlightColor: [255, 200, 0, 160],
                _validate: false,
                onHover: (info) => {
                  if (this.map) {
                    this.map.getCanvas().style.cursor = info.object ? 'pointer' : '';
                  }
                },
                onClick: emitSelectFromInfo,
                updateTriggers: {
                  getFillColor: [selectedIndex, this.isDark],
                  getLineColor: [selectedIndex, this.isDark]
                }
              })
            );
          }
        }
      }

      this.overlay.setProps({ layers });

      // MapLibre needs an explicit repaint tick for the deck.gl canvas overlay to refresh.
      if (this.map) this.map.triggerRepaint();
    },

    fitBounds() {
      if (!this.bounds || !this.map) return;
      // Skip fitBounds only when viewport-filtered mode was active (viewport=1 in URL).
      // For regular shared URLs, always fit to data extent.
      if (this.skipInitialFit && !this.hasFittedOnce) {
        this.hasFittedOnce = true;
        return;
      }
      this.hasFittedOnce = true;
      // Validate bounds are finite numbers before calling fitBounds.
      const [[w, s], [e, n]] = this.bounds;
      if (!isFinite(w) || !isFinite(s) || !isFinite(e) || !isFinite(n)) return;
      // Sanity-check that coordinates are in valid WGS84 range.
      if (Math.abs(w) > 180 || Math.abs(e) > 180 || Math.abs(s) > 90 || Math.abs(n) > 90) {
        console.warn(
          'MapView: bounds appear to be in non-WGS84 CRS — skipping fitBounds',
          this.bounds
        );
        return;
      }
      try {
        this.map.fitBounds(
          this.bounds,
          { padding: 50, maxZoom: 15, duration: 500 },
          { automated: true }
        );
      } catch (e) {
        console.warn('fitBounds failed:', e.message);
      }
    },

    updateBboxLayer() {
      if (!this.map || !this.ready) return;
      const bbox = this.bbox;

      // Remove existing layers/source first
      if (this.map.getLayer('bbox-fill')) {
        this.map.removeLayer('bbox-fill');
      }
      if (this.map.getSource('bbox')) {
        this.map.removeSource('bbox');
      }

      if (!bbox) return;
      const [minx, miny, maxx, maxy] = bbox;
      if ([minx, miny, maxx, maxy].some((v) => !isFinite(v))) return; // validate bbox values

      // Sanity-check that coordinates are in projection of the geometries before adding source/layer.
      if (
        Math.abs(minx) > 180 ||
        Math.abs(maxx) > 180 ||
        Math.abs(miny) > 90 ||
        Math.abs(maxy) > 90
      ) {
        console.warn('MapView: bbox appears to be in non-WGS84 CRS — skipping bbox layer', bbox);
        return;
      }

      // Add a GeoJSON source with a polygon geometry representing the bbox as a hole in a world-covering polygon.
      this.map.addSource('bbox', {
        type: 'geojson',
        data: {
          type: 'Feature',
          geometry: {
            type: 'Polygon',
            coordinates: [
              // Outer ring: entire world
              [
                [-180, -90],
                [180, -90],
                [180, 90],
                [-180, 90],
                [-180, -90]
              ],
              // Inner ring (hole): the bbox, wound clockwise to cut it out
              [
                [minx, miny],
                [minx, maxy],
                [maxx, maxy],
                [maxx, miny],
                [minx, miny]
              ]
            ]
          }
        }
      });

      // Subtle fill so it doesn't obscure the data underneath
      this.map.addLayer({
        id: 'bbox-fill',
        type: 'fill',
        source: 'bbox',
        paint: {
          'fill-color': '#000000',
          'fill-opacity': 0.25
        }
      });
    },

    /**
     * Zoom the map to the geometry of a specific feature.
     */
    zoomToFeature(index) {
      if (!this.map) return;

      // Lazy bounds: compute from WKB only when needed, then cache.
      let bounds = this.geoBoundsCache[index];
      if (!bounds) {
        const wkb = this.wkbByIndex[index];
        if (!wkb) return;
        const geometry = parseWKB(wkb);
        if (!geometry?.coordinates) return;
        let west = Infinity,
          south = Infinity,
          east = -Infinity,
          north = -Infinity;
        const visit = (c) => {
          if (typeof c[0] === 'number' && typeof c[1] === 'number') {
            if (c[0] < west) west = c[0];
            if (c[1] < south) south = c[1];
            if (c[0] > east) east = c[0];
            if (c[1] > north) north = c[1];
            return;
          }
          for (const child of c) visit(child);
        };
        visit(geometry.coordinates);
        if (!isFinite(west)) return;
        bounds = [west, south, east, north];
        this.geoBoundsCache[index] = bounds;
      }

      const [[w, s], [e, n]] = [
        [bounds[0], bounds[1]],
        [bounds[2], bounds[3]]
      ];

      if (!isFinite(w) || !isFinite(s) || !isFinite(e) || !isFinite(n)) return;

      if (Math.abs(e - w) < 1e-9 && Math.abs(n - s) < 1e-9) {
        this.map.flyTo({
          center: [w, s],
          zoom: Math.max(this.map.getZoom(), 12),
          duration: 500
        });
        return;
      }

      this.map.fitBounds(
        [
          [w, s],
          [e, n]
        ],
        { padding: 80, maxZoom: 15, duration: 500 }
      );
    }
  }
};
</script>

<style scoped>
.map-container {
  width: 100%;
  height: 100%;
  position: relative;
}

.reload-viewport-btn {
  position: absolute;
  top: 10px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 100;
  padding: 6px 16px;
  background: rgb(var(--v-theme-primary));
  color: rgb(var(--v-theme-on-primary));
  border: none;
  border-radius: 4px;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.3);
}

.reload-viewport-btn:hover {
  background: rgb(var(--v-theme-primary));
}

.reload-viewport-btn:disabled {
  opacity: 0.5;
  cursor: default;
}
</style>
