<template>
  <div ref="mapContainer" class="map-container"></div>
</template>

<script>
import maplibregl from 'maplibre-gl';
import { MapboxOverlay } from '@deck.gl/mapbox';
import {
  GeoArrowPathLayer,
  GeoArrowPolygonLayer,
  GeoArrowScatterplotLayer
} from '@geoarrow/deck.gl-layers';

const NORMAL_FILL = [51, 153, 204, 120];
const NORMAL_LINE = [51, 153, 204, 200];
const SELECTED_FILL = [255, 80, 80, 180];
const SELECTED_LINE = [255, 0, 0, 255];

export default {
  name: 'MapView',
  props: {
    geoArrowResults: { type: Array, default: () => [] },
    selectedIndex: { type: Number, default: null },
    bounds: { type: Array, default: null },
    geometryBoundsByIndex: { type: Object, default: () => ({}) }
  },
  emits: ['select', 'viewportChange'],
  data() {
    return {
      map: null,
      overlay: null,
      ready: false,
      moveEndTimer: null
    };
  },
  watch: {
    geoArrowResults: {
      handler() {
        this.updateLayers();
        if (this.bounds) {
          this.fitBounds();
        }
      }
    },
    selectedIndex() {
      this.updateLayers();
    },
    bounds() {
      this.fitBounds();
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
        center: [0, 20],
        zoom: 2,
        attributionControl: true
      });

      this.map.addControl(new maplibregl.NavigationControl(), 'top-right');

      this.overlay = new MapboxOverlay({ layers: [], interleaved: false });
      this.map.addControl(this.overlay);

      this.map.on('load', () => {
        this.ready = true;
        this.updateLayers();
        if (this.bounds) this.fitBounds();
      });

      // Emit viewport bounds on pan/zoom (debounced 400 ms)
      this.map.on('moveend', () => {
        if (this.moveEndTimer) clearTimeout(this.moveEndTimer);
        this.moveEndTimer = setTimeout(() => this.emitViewport(), 400);
      });
    },

    emitViewport() {
      if (!this.map) return;
      const b = this.map.getBounds();
      this.$emit('viewportChange', [
        b.getWest(),
        b.getSouth(),
        b.getEast(),
        b.getNorth()
      ]);
    },

    updateLayers() {
      if (!this.overlay || !this.ready) return;

      const layers = [];
      if (this.geoArrowResults.length > 0) {
        const selectedIndex = this.selectedIndex;
        const getColorIndex = (row) => this.rowIndex(row) === selectedIndex;
        const emitSelectFromInfo = (info) => {
          const index = this.rowIndex(info?.object);
          if (index !== null) this.$emit('select', index);
        };

        for (let i = 0; i < this.geoArrowResults.length; i++) {
          const result = this.geoArrowResults[i];
          const layerId = `geoarrow-${result.geometryType}-${i}`;

          if (result.geometryType === 'point' || result.geometryType === 'multipoint') {
            layers.push(
              new GeoArrowScatterplotLayer({
                id: layerId,
                data: result.table,
                getFillColor: (row) =>
                  getColorIndex(row) ? SELECTED_FILL : NORMAL_FILL,
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
                  getFillColor: [selectedIndex]
                }
              })
            );
          } else if (result.geometryType === 'linestring' || result.geometryType === 'multilinestring') {
            layers.push(
              new GeoArrowPathLayer({
                id: layerId,
                data: result.table,
                getColor: (row) =>
                  getColorIndex(row) ? SELECTED_LINE : NORMAL_LINE,
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
                  getColor: [selectedIndex]
                }
              })
            );
          } else {
            layers.push(
              new GeoArrowPolygonLayer({
                id: layerId,
                data: result.table,
                getFillColor: (row) =>
                  getColorIndex(row) ? SELECTED_FILL : NORMAL_FILL,
                getLineColor: (row) =>
                  getColorIndex(row) ? SELECTED_LINE : NORMAL_LINE,
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
                  getFillColor: [selectedIndex],
                  getLineColor: [selectedIndex]
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
      // Validate bounds are finite numbers before calling fitBounds.
      const [[w, s], [e, n]] = this.bounds;
      if (!isFinite(w) || !isFinite(s) || !isFinite(e) || !isFinite(n)) return;
      // Sanity-check that coordinates are in valid WGS84 range.
      if (Math.abs(w) > 180 || Math.abs(e) > 180 || Math.abs(s) > 90 || Math.abs(n) > 90) {
        console.warn('MapView: bounds appear to be in non-WGS84 CRS — skipping fitBounds', this.bounds);
        return;
      }
      try {
        this.map.fitBounds(this.bounds, { padding: 50, maxZoom: 15, duration: 500 });
      } catch (e) {
        console.warn('fitBounds failed:', e.message);
      }
    },

    /**
     * Zoom the map to the geometry of a specific feature.
     */
    zoomToFeature(index) {
      if (!this.map) return;

      const bounds = this.geometryBoundsByIndex?.[index];
      if (!bounds) return;

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
}
</style>
