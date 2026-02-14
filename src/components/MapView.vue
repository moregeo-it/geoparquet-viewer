<template>
  <div ref="mapContainer" class="map-container"></div>
</template>

<script>
import maplibregl from 'maplibre-gl';
import { MapboxOverlay } from '@deck.gl/mapbox';
import { GeoJsonLayer } from '@deck.gl/layers';

const NORMAL_FILL = [51, 153, 204, 120];
const NORMAL_LINE = [51, 153, 204, 200];
const SELECTED_FILL = [255, 80, 80, 180];
const SELECTED_LINE = [255, 0, 0, 255];

export default {
  name: 'MapView',
  props: {
    features: { type: Array, default: () => [] },
    selectedIndex: { type: Number, default: null },
    bounds: { type: Array, default: null }
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
    features: {
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

      this.overlay = new MapboxOverlay({
        layers: []
      });
      this.map.addControl(this.overlay);

      this.map.on('load', () => {
        this.ready = true;
        this.updateLayers();
        if (this.bounds) this.fitBounds();
      });

      // Emit viewport bounds on every pan/zoom (debounced)
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
      if (this.features.length > 0) {
        const selectedIndex = this.selectedIndex;
        layers.push(
          new GeoJsonLayer({
            id: 'data-layer',
            data: this.features,
            pickable: true,
            stroked: true,
            filled: true,
            pointType: 'circle',
            getFillColor: (f) =>
              f.properties.__index === selectedIndex ? SELECTED_FILL : NORMAL_FILL,
            getLineColor: (f) =>
              f.properties.__index === selectedIndex ? SELECTED_LINE : NORMAL_LINE,
            getLineWidth: 2,
            getPointRadius: 6,
            pointRadiusMinPixels: 3,
            pointRadiusMaxPixels: 20,
            lineWidthMinPixels: 1,
            lineWidthMaxPixels: 4,
            autoHighlight: true,
            highlightColor: [255, 200, 0, 160],
            onHover: (info) => {
              if (this.map) {
                this.map.getCanvas().style.cursor = info.object ? 'pointer' : '';
              }
            },
            onClick: (info) => {
              if (info.object) {
                this.$emit('select', info.object.properties.__index);
              }
            },
            updateTriggers: {
              getFillColor: [selectedIndex],
              getLineColor: [selectedIndex]
            }
          })
        );
      }

      this.overlay.setProps({ layers });
      // Ensure MapLibre triggers a repaint so the deck.gl overlay renders
      if (this.map) this.map.triggerRepaint();
    },

    fitBounds() {
      if (!this.bounds || !this.map) return;
      try {
        this.map.fitBounds(this.bounds, {
          padding: 50,
          maxZoom: 15,
          duration: 500
        });
      } catch (e) {
        console.warn('fitBounds failed:', e.message);
      }
    },

    /**
     * Zoom the map to the geometry of a specific feature.
     */
    zoomToFeature(index) {
      const feature = this.features.find((f) => f.properties.__index === index);
      if (!feature || !feature.geometry || !this.map) return;
      const geom = feature.geometry;
      if (geom.type === 'Point') {
        this.map.flyTo({
          center: geom.coordinates,
          zoom: Math.max(this.map.getZoom(), 12),
          duration: 500
        });
      } else {
        // Compute bounds from geometry
        let west = Infinity,
          south = Infinity,
          east = -Infinity,
          north = -Infinity;
        const visit = (coords) => {
          if (typeof coords[0] === 'number') {
            if (coords[0] < west) west = coords[0];
            if (coords[1] < south) south = coords[1];
            if (coords[0] > east) east = coords[0];
            if (coords[1] > north) north = coords[1];
          } else {
            for (const c of coords) visit(c);
          }
        };
        visit(geom.coordinates || []);
        if (isFinite(west)) {
          this.map.fitBounds(
            [
              [west, south],
              [east, north]
            ],
            { padding: 80, maxZoom: 15, duration: 500 }
          );
        }
      }
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
