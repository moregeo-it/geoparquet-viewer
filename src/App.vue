<template>
  <v-app>
    <v-progress-linear
      v-if="loading"
      indeterminate
      color="primary"
      height="3"
      style="position: fixed; top: 0; z-index: 9999"
    />

    <v-app-bar color="grey-darken-3" density="compact" flat>
      <v-app-bar-title class="text-body-1 font-weight-bold flex-grow-0 mr-4">
        GeoParquet Viewer
      </v-app-bar-title>
      <v-spacer />
      <v-btn size="small" @click="loadDialogOpen = true">Load Data</v-btn>
      <v-btn v-if="schema" size="small" @click="schemaDialogOpen = true">Schema</v-btn>
      <v-btn
        v-if="kvMetadata"
        size="small"
        @click="openMetadataDialog('Key-Value Metadata', kvMetadata)"
      >
        KV Metadata
      </v-btn>
      <v-btn
        v-if="geoMetadata"
        size="small"
        @click="openMetadataDialog('GeoParquet Metadata', geoMetadata)"
      >
        Geo Metadata
      </v-btn>
      <v-btn
        v-if="fileMetadata"
        size="small"
        @click="openMetadataDialog('Parquet File Metadata', fileMetadata)"
      >
        File Info
      </v-btn>
      <v-btn size="small" @click="aboutDialogOpen = true">About</v-btn>
    </v-app-bar>

    <v-main>
      <div class="d-flex flex-column fill-height">
        <v-toolbar
          v-if="source"
          density="compact"
          color="grey-darken-1"
          flat
          class="flex-grow-0"
        >
          <v-toolbar-title class="text-caption">
            <code>{{ displaySource }}</code>
          </v-toolbar-title>
          <v-spacer />
          <span class="text-caption text-grey-lighten-1 mr-3">
            <template v-if="filteredCount !== null && filteredCount !== totalRows">
              {{ filteredCount.toLocaleString() }} matched &middot;
            </template>
            {{ loadedCount.toLocaleString() }} loaded /
            {{ totalRows >= 0 ? totalRows.toLocaleString() : '?' }} total
          </span>
        </v-toolbar>

        <div v-if="source" class="content-panels d-flex flex-grow-1" style="min-height: 0">
          <div class="left-panel d-flex flex-column">
            <FilterPanel
              v-if="nonGeoColumns.length > 0"
              :columns="nonGeoColumns"
              :filters="filters"
              @apply="applyFilters"
            />
            <TableView
              :rows="rows"
              :columns="nonGeoColumns"
              :selectedIndex="selectedIndex"
              @select="onTableSelect"
            />
            <div
              v-if="hasMore"
              class="d-flex justify-center ga-2 pa-1 bg-grey-lighten-4"
              style="border-top: 1px solid #ddd"
            >
              <v-btn size="small" variant="outlined" @click="loadMore" :disabled="loading">
                Load more ({{ pageSize.toLocaleString() }} rows)
              </v-btn>
              <v-btn
                v-if="remainingRows > pageSize"
                size="small"
                variant="outlined"
                @click="loadAll"
                :disabled="loading"
              >
                Load all remaining
              </v-btn>
            </div>
          </div>
          <div class="right-panel">
            <MapView
              ref="mapView"
              :features="features"
              :selectedIndex="selectedIndex"
              :bounds="mapBounds"
              @select="onMapSelect"
              @viewportChange="onViewportChange"
            />
          </div>
        </div>

        <div
          v-else
          class="d-flex flex-column align-center justify-center flex-grow-1 text-center pa-8"
        >
          <h2 class="text-h5 mb-2">GeoParquet Viewer</h2>
          <p class="text-body-2 text-grey-darken-1 mb-1" style="max-width: 500px">
            Load a <a href="https://geoparquet.org" target="_blank">GeoParquet</a> file to
            visualize it on a map and explore the data in a table.
          </p>
          <p class="text-body-2 text-grey-darken-1" style="max-width: 500px">
            Supports local files and remote URLs with HTTP range requests.
          </p>
          <v-btn color="primary" class="mt-4" size="large" @click="loadDialogOpen = true">
            Load Data
          </v-btn>
        </div>
      </div>
    </v-main>

    <v-sheet
      v-if="statusMessage"
      :color="isError ? 'error' : 'grey-darken-3'"
      class="status-bar text-caption px-3 d-flex align-center"
      :class="isError ? 'text-white' : 'text-grey-lighten-1'"
    >
      {{ statusMessage }}
    </v-sheet>

    <LoadDataModal
      v-model="loadDialogOpen"
      :url="source || ''"
      @save="loadFromUrl"
      @load-file="loadFromFile"
    />
    <SchemaModal
      v-model="schemaDialogOpen"
      :schema="schema || []"
      :geo-metadata="geoMetadata"
    />
    <MetadataModal
      v-model="metadataDialogOpen"
      :title="metadataDialogTitle"
      :data="metadataDialogData"
    />
    <AboutModal v-model="aboutDialogOpen" />
  </v-app>
</template>

<script>
import {
  initDB,
  isSpatialLoaded,
  registerLocalFile,
  dropFile,
  getSchema,
  getRowCount,
  getKVMetadata,
  getParquetFileMetadata,
  queryData,
  queryCount
} from './db.js';
import { wkbToGeoJSON, computeBounds } from './wkb.js';

import MapView from './components/MapView.vue';
import TableView from './components/TableView.vue';
import FilterPanel from './components/FilterPanel.vue';

import AboutModal from './components/modals/AboutModal.vue';
import LoadDataModal from './components/modals/LoadDataModal.vue';
import MetadataModal from './components/modals/MetadataModal.vue';
import SchemaModal from './components/modals/SchemaModal.vue';

const DEFAULT_PAGE_SIZE = 5000;
const MAX_FEATURES_ON_MAP = 100000;

function getDefaultUrl() {
  const urlParams = new URLSearchParams(window.location.search);
  return urlParams.get('url') || null;
}

export default {
  name: 'App',
  components: {
    MapView,
    TableView,
    FilterPanel,
    AboutModal,
    LoadDataModal,
    MetadataModal,
    SchemaModal
  },
  data() {
    return {
      // Source
      source: null,
      displaySource: '',
      localFileName: null,

      // Schema & metadata
      schema: null,
      kvMetadata: null,
      geoMetadata: null,
      fileMetadata: null,
      totalRows: -1,

      // Data
      rows: [],
      features: [],
      mapBounds: null,

      // Selection
      selectedIndex: null,

      // Filters
      filters: [],
      filteredCount: null,

      // Pagination
      pageSize: DEFAULT_PAGE_SIZE,
      currentOffset: 0,
      lastPageFull: false,

      // Viewport
      viewportBounds: null,
      pendingViewportReload: false,
      viewportGeneration: 0,

      // UI state
      loading: false,
      statusMessage: '',
      isError: false,

      // Dialog visibility
      loadDialogOpen: false,
      schemaDialogOpen: false,
      metadataDialogOpen: false,
      aboutDialogOpen: false,

      // Metadata dialog content (shared by KV / Geo / File metadata)
      metadataDialogTitle: '',
      metadataDialogData: null
    };
  },
  computed: {
    /** The primary geometry column name from GeoParquet metadata or schema detection */
    primaryGeoColumn() {
      if (this.geoMetadata?.primary_column) return this.geoMetadata.primary_column;
      return this.detectedGeoColumn;
    },
    /** Detected geometry column from schema (fallback when no geo metadata) */
    detectedGeoColumn() {
      if (!this.schema) return null;
      const geoTypes = ['GEOMETRY', 'BLOB', 'WKB_GEOMETRY', 'BYTEA'];
      const geoNames = ['geometry', 'geom', 'wkb_geometry', 'the_geom', 'shape'];
      for (const col of this.schema) {
        if (geoNames.includes(col.name.toLowerCase())) return col.name;
      }
      for (const col of this.schema) {
        if (geoTypes.includes(col.type.toUpperCase())) return col.name;
      }
      return null;
    },
    /** CRS object for the primary geometry column (null = WGS 84 per GeoParquet spec) */
    primaryGeoCrs() {
      if (!this.geoMetadata?.columns || !this.primaryGeoColumn) return null;
      const colMeta = this.geoMetadata.columns[this.primaryGeoColumn];
      return colMeta?.crs ?? null;
    },
    /** Whether geometry needs reprojection to WGS 84 for display */
    needsReprojection() {
      const crs = this.primaryGeoCrs;
      if (!crs) return false;
      if (crs.id?.authority === 'EPSG' && crs.id?.code === 4326) return false;
      return true;
    },
    /**
     * Source CRS string for ST_Transform.
     * Always passes the full PROJJSON from GeoParquet metadata instead of EPSG codes,
     * because DuckDB-WASM's spatial extension doesn't ship the PROJ database needed
     * for EPSG code lookups (crashes with _setThrew). PROJ can parse PROJJSON directly.
     */
    sourceCrsString() {
      if (!this.needsReprojection) return null;
      return JSON.stringify(this.primaryGeoCrs);
    },
    /** Whether the primary geo column has covering/bbox metadata */
    hasBboxCovering() {
      if (!this.geoMetadata?.columns || !this.primaryGeoColumn) return false;
      const colMeta = this.geoMetadata.columns[this.primaryGeoColumn];
      return !!(colMeta?.covering?.bbox);
    },
    /** All geometry column names */
    geoColumns() {
      if (this.geoMetadata?.columns) return Object.keys(this.geoMetadata.columns);
      if (this.detectedGeoColumn) return [this.detectedGeoColumn];
      return [];
    },
    /** Columns to show in the table (exclude geometry columns and internal fields) */
    nonGeoColumns() {
      if (!this.schema) return [];
      return this.schema.filter(
        (col) => !this.geoColumns.includes(col.name) && !col.name.startsWith('__')
      );
    },
    /** Number of rows currently loaded */
    loadedCount() {
      return this.rows.length;
    },
    /** Whether there are more rows to load */
    hasMore() {
      if (this.hasBboxCovering && this.viewportBounds && this.filteredCount === null) {
        return this.lastPageFull;
      }
      if (this.filteredCount !== null) {
        return this.loadedCount < this.filteredCount;
      }
      return this.totalRows >= 0 && this.loadedCount < this.totalRows;
    },
    /** Remaining rows that can be loaded */
    remainingRows() {
      const total = this.filteredCount !== null ? this.filteredCount : this.totalRows;
      return Math.max(0, total - this.loadedCount);
    }
  },
  mounted() {
    const url = getDefaultUrl();
    if (url) {
      this.loadFromUrl(url);
    } else {
      this.loadDialogOpen = true;
    }
  },
  methods: {
    // ── Dialog helpers ─────────────────────────────────────
    openMetadataDialog(title, data) {
      this.metadataDialogTitle = title;
      this.metadataDialogData = data;
      this.metadataDialogOpen = true;
    },

    // ── Status ────────────────────────────────────────────
    setStatus(msg, error = false) {
      this.statusMessage = msg;
      this.isError = error;
      if (!error && msg) {
        setTimeout(() => {
          if (this.statusMessage === msg) this.statusMessage = '';
        }, 5000);
      }
    },

    // ── Data loading ──────────────────────────────────────
    async loadFromUrl(url) {
      history.pushState({}, '', `?url=${encodeURIComponent(url)}`);
      this.reset();
      this.source = url;
      this.displaySource = url;
      await this.loadData();
    },

    async loadFromFile(file) {
      history.pushState({}, '', window.location.pathname);
      this.reset();
      const name = 'local_' + file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
      this.setStatus(`Reading file ${file.name} (${(file.size / 1024 / 1024).toFixed(1)} MB)...`);

      try {
        const buffer = await file.arrayBuffer();
        await registerLocalFile(name, buffer);
        this.localFileName = name;
        this.source = name;
        this.displaySource = file.name;
        await this.loadData();
      } catch (e) {
        this.setStatus(`Failed to load file: ${e.message}`, true);
        this.loading = false;
      }
    },

    reset() {
      if (this.localFileName) {
        dropFile(this.localFileName).catch(() => {});
      }
      this.source = null;
      this.displaySource = '';
      this.localFileName = null;
      this.schema = null;
      this.kvMetadata = null;
      this.geoMetadata = null;
      this.fileMetadata = null;
      this.totalRows = -1;
      this.rows = [];
      this.features = [];
      this.mapBounds = null;
      this.selectedIndex = null;
      this.filters = [];
      this.filteredCount = null;
      this.currentOffset = 0;
      this.isError = false;
      this.statusMessage = '';
    },

    async loadData() {
      this.loading = true;
      try {
        this.setStatus('Initializing DuckDB...');
        await initDB((msg) => this.setStatus(msg));

        this.setStatus('Reading schema...');
        this.schema = await getSchema(this.source);

        this.setStatus('Counting rows...');
        this.totalRows = await getRowCount(this.source);

        this.setStatus('Reading metadata...');
        try {
          this.kvMetadata = await getKVMetadata(this.source);
          if (this.kvMetadata.geo && typeof this.kvMetadata.geo === 'object') {
            this.geoMetadata = this.kvMetadata.geo;
          }
        } catch (e) {
          console.warn('Could not read KV metadata:', e.message);
        }

        try {
          this.fileMetadata = await getParquetFileMetadata(this.source);
        } catch (e) {
          console.warn('Could not read file metadata:', e.message);
        }

        this.setStatus('Loading data...');
        await this.executeQuery(0);

        this.setStatus(
          `Loaded ${this.loadedCount.toLocaleString()} of ${this.totalRows.toLocaleString()} rows.`
        );
      } catch (e) {
        console.error('Load error:', e);
        this.setStatus(`Error: ${e.message}`, true);
      } finally {
        this.loading = false;
        if (this.pendingViewportReload && this.hasBboxCovering) {
          this.pendingViewportReload = false;
          this.reloadForViewport();
        }
      }
    },

    async loadMore() {
      if (!this.hasMore || this.loading) return;
      this.loading = true;
      try {
        this.setStatus('Loading more data...');
        await this.executeQuery(this.currentOffset);
        this.setStatus(`Loaded ${this.loadedCount.toLocaleString()} rows.`);
      } catch (e) {
        this.setStatus(`Error loading more: ${e.message}`, true);
      } finally {
        this.loading = false;
      }
    },

    async loadAll() {
      if (!this.hasMore || this.loading) return;
      this.loading = true;
      try {
        this.setStatus('Loading all remaining data...');
        await this.executeQuery(this.currentOffset, null);
        this.setStatus(`Loaded ${this.loadedCount.toLocaleString()} rows.`);
      } catch (e) {
        this.setStatus(`Error: ${e.message}`, true);
      } finally {
        this.loading = false;
      }
    },

    async applyFilters(newFilters) {
      this.filters = newFilters;
      this.loading = true;
      try {
        this.rows = [];
        this.features = [];
        this.currentOffset = 0;
        this.selectedIndex = null;

        this.setStatus('Counting filtered rows...');
        this.filteredCount = await queryCount(
          this.source,
          this.filters,
          this.hasBboxCovering ? this.viewportBounds : null,
          this.primaryGeoColumn,
          this.sourceCrsString
        );

        this.setStatus('Loading filtered data...');
        await this.executeQuery(0);

        this.setStatus(
          `Filter matched ${this.filteredCount.toLocaleString()} rows. Showing ${this.loadedCount.toLocaleString()}.`
        );
      } catch (e) {
        this.setStatus(`Filter error: ${e.message}`, true);
      } finally {
        this.loading = false;
      }
    },

    /**
     * Execute query, append results to rows/features.
     */
    async executeQuery(offset, limit = this.pageSize) {
      const result = await queryData(this.source, {
        geoColumn: this.primaryGeoColumn,
        filters: this.filters,
        bbox: this.hasBboxCovering ? this.viewportBounds : null,
        sourceCrs: this.sourceCrsString,
        limit,
        offset
      });

      const arrowRows = result.toArray();
      const fieldNames = result.schema.fields.map((f) => f.name);
      const hasSpatial = isSpatialLoaded();
      const geoCol = this.primaryGeoColumn;

      const newRows = [];
      const newFeatures = [];

      for (let i = 0; i < arrowRows.length; i++) {
        const arrowRow = arrowRows[i];
        const globalIndex = offset + i;

        // Build plain row object for table
        const row = { __index: globalIndex };
        for (const name of fieldNames) {
          if (name === '__geojson') continue;
          if (this.geoColumns.includes(name)) continue;
          const val = arrowRow[name];
          if (typeof val === 'bigint') {
            row[name] = Number(val);
          } else if (ArrayBuffer.isView(val)) {
            row[name] = `[binary ${val.byteLength}B]`;
          } else if (val instanceof Date) {
            row[name] = val.toISOString();
          } else if (val !== null && val !== undefined && typeof val === 'object') {
            try {
              row[name] = JSON.stringify(val);
            } catch {
              row[name] = String(val);
            }
          } else {
            row[name] = val;
          }
        }
        newRows.push(row);

        // Build GeoJSON feature for map
        if (geoCol && this.features.length + newFeatures.length < MAX_FEATURES_ON_MAP) {
          let geometry = null;
          try {
            if (hasSpatial && arrowRow.__geojson) {
              geometry = JSON.parse(arrowRow.__geojson);
            } else if (!this.needsReprojection && arrowRow[geoCol]) {
              const wkb = arrowRow[geoCol];
              if (wkb instanceof Uint8Array || ArrayBuffer.isView(wkb)) {
                geometry = wkbToGeoJSON(wkb);
              }
            }
          } catch (e) {
            console.warn(`Skipped geometry at row ${globalIndex}:`, e.message);
          }

          if (geometry) {
            newFeatures.push({
              type: 'Feature',
              properties: { __index: globalIndex },
              geometry
            });
          }
        }
      }

      this.rows = [...this.rows, ...newRows];
      this.features = [...this.features, ...newFeatures];
      this.currentOffset = offset + arrowRows.length;
      this.lastPageFull = limit ? arrowRows.length >= limit : false;

      // Calculate bounds from features if this is the first load
      if (offset === 0 && this.features.length > 0) {
        const geoColMeta = this.geoMetadata?.columns?.[geoCol];
        if (!this.needsReprojection && geoColMeta?.bbox && geoColMeta.bbox.length >= 4) {
          const [minx, miny, maxx, maxy] = geoColMeta.bbox;
          this.mapBounds = [
            [minx, miny],
            [maxx, maxy]
          ];
        } else {
          this.mapBounds = computeBounds(this.features);
        }
      }
    },

    // ── Selection sync ────────────────────────────────────
    onTableSelect(index) {
      this.selectedIndex = index;
      if (this.$refs.mapView) {
        this.$refs.mapView.zoomToFeature(index);
      }
    },

    onMapSelect(index) {
      this.selectedIndex = index;
    },

    // ── Viewport-driven spatial filtering ──────────────────
    onViewportChange(bbox) {
      this.viewportBounds = bbox;
      if (!this.source || !this.hasBboxCovering) return;
      if (this.loading) {
        this.pendingViewportReload = true;
        return;
      }
      this.reloadForViewport();
    },

    async reloadForViewport() {
      const gen = ++this.viewportGeneration;
      this.loading = true;
      try {
        this.rows = [];
        this.features = [];
        this.currentOffset = 0;
        this.selectedIndex = null;

        this.setStatus('Loading data in viewport...');
        await this.executeQuery(0);

        if (gen !== this.viewportGeneration) return;

        this.setStatus(`Loaded ${this.loadedCount.toLocaleString()} rows in viewport.`);
      } catch (e) {
        if (gen === this.viewportGeneration) {
          this.setStatus(`Error: ${e.message}`, true);
        }
      } finally {
        this.loading = false;
      }
    }
  }
};
</script>

<style>
.left-panel {
  width: 50%;
  min-width: 300px;
  border-right: 2px solid #ccc;
}
.right-panel {
  flex: 1;
  min-width: 300px;
}
.status-bar {
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  height: 24px;
  z-index: 500;
}

@media (max-width: 768px) {
  .content-panels {
    flex-direction: column !important;
  }
  .left-panel {
    width: 100% !important;
    height: 50%;
    border-right: none !important;
    border-bottom: 2px solid #ccc;
  }
  .right-panel {
    height: 50%;
    min-width: unset !important;
  }
}
</style>
