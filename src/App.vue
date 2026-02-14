<template>
  <div id="viewer">
    <header id="header">
      <div class="row header-row">
        <h1 class="title">GeoParquet Viewer</h1>
        <div class="header-actions">
          <button @click="showLoad" class="btn">Load Data</button>
          <button v-if="schema" @click="showSchemaModal" class="btn">Schema</button>
          <button v-if="kvMetadata" @click="showKvMetadata" class="btn">KV Metadata</button>
          <button v-if="geoMetadata" @click="showGeoMetadata" class="btn">Geo Metadata</button>
          <button v-if="fileMetadata" @click="showFileMetadata" class="btn">File Info</button>
          <button @click="showAboutModal" class="btn">About</button>
        </div>
      </div>
      <div v-if="source" class="row sub-header">
        <span class="source-info">
          <code>{{ displaySource }}</code>
        </span>
        <span class="row-counts">
          <template v-if="filteredCount !== null && filteredCount !== totalRows">
            {{ filteredCount.toLocaleString() }} matched &middot;
          </template>
          {{ loadedCount.toLocaleString() }} loaded /
          {{ totalRows >= 0 ? totalRows.toLocaleString() : '?' }} total
        </span>
      </div>
    </header>

    <main id="main">
      <template v-if="source">
        <div id="left-panel">
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
          <div v-if="hasMore" class="load-more-bar">
            <button @click="loadMore" :disabled="loading" class="btn btn-sm">
              Load more ({{ pageSize.toLocaleString() }} rows)
            </button>
            <button
              v-if="remainingRows > pageSize"
              @click="loadAll"
              :disabled="loading"
              class="btn btn-sm"
            >
              Load all remaining
            </button>
          </div>
        </div>
        <div id="right-panel">
          <MapView
            ref="mapView"
            :features="features"
            :selectedIndex="selectedIndex"
            :bounds="mapBounds"
            @select="onMapSelect"
            @viewportChange="onViewportChange"
          />
        </div>
      </template>
      <div v-else class="welcome">
        <h2>GeoParquet Viewer</h2>
        <p>
          Load a <a href="https://geoparquet.org" target="_blank">GeoParquet</a> file to visualize
          it on a map and explore the data in a table.
        </p>
        <p>Supports local files and remote URLs with HTTP range requests.</p>
        <button @click="showLoad" class="btn btn-primary">Load Data</button>
      </div>
    </main>

    <div v-if="statusMessage" class="status-bar" :class="{ error: isError }">
      {{ statusMessage }}
    </div>

    <template v-for="modal in modals" :key="modal.id">
      <component
        :is="modal.component"
        v-bind="modal.props"
        v-on="modal.events"
        @close="hideModal(modal)"
      />
    </template>

    <LoadingSpinner v-if="loading" />
  </div>
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
import Utils from './utils.js';

import MapView from './components/MapView.vue';
import TableView from './components/TableView.vue';
import FilterPanel from './components/FilterPanel.vue';
import LoadingSpinner from './components/LoadingSpinner.vue';

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
    LoadingSpinner,
    AboutModal,
    LoadDataModal,
    MetadataModal,
    SchemaModal
  },
  data() {
    return {
      // Source
      source: null, // DuckDB source path (URL or registered filename)
      displaySource: '', // Human-readable source name
      localFileName: null, // Registered local file name

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
      modals: []
    };
  },
  computed: {
    /** The primary geometry column name from GeoParquet metadata or schema detection */
    primaryGeoColumn() {
      if (this.geoMetadata?.primary_column) return this.geoMetadata.primary_column;
      // Fallback: detect geometry column from schema type
      return this.detectedGeoColumn;
    },
    /** Detected geometry column from schema (fallback when no geo metadata) */
    detectedGeoColumn() {
      if (!this.schema) return null;
      const geoTypes = ['GEOMETRY', 'BLOB', 'WKB_GEOMETRY', 'BYTEA'];
      const geoNames = ['geometry', 'geom', 'wkb_geometry', 'the_geom', 'shape'];
      // First try matching known geometry column names
      for (const col of this.schema) {
        if (geoNames.includes(col.name.toLowerCase())) return col.name;
      }
      // Then try matching geometry types
      for (const col of this.schema) {
        if (geoTypes.includes(col.type.toUpperCase())) return col.name;
      }
      return null;
    },
    /** CRS object for the primary geometry column (null = WGS 84 per GeoParquet spec) */
    primaryGeoCrs() {
      if (!this.geoMetadata?.columns || !this.primaryGeoColumn) return null;
      const colMeta = this.geoMetadata.columns[this.primaryGeoColumn];
      return colMeta?.crs ?? null; // absent/null = WGS 84 per spec
    },
    /** Whether geometry needs reprojection to WGS 84 for display */
    needsReprojection() {
      const crs = this.primaryGeoCrs;
      if (!crs) return false; // null/absent CRS = WGS 84
      // Already EPSG:4326
      if (crs.id?.authority === 'EPSG' && crs.id?.code === 4326) return false;
      return true;
    },
    /**
     * Source CRS string for ST_Transform.
     * Always passes the full PROJJSON from GeoParquet metadata instead of EPSG codes,
     * because DuckDB-WASM's spatial extension doesn't ship the PROJ database needed
     * for EPSG code lookups (crashes with _setThrew). PROJ can parse PROJJSON directly.
     * null when no reprojection is needed.
     */
    sourceCrsString() {
      if (!this.needsReprojection) return null;
      return JSON.stringify(this.primaryGeoCrs);
    },
    /** Whether the primary geo column has covering/bbox metadata (enables efficient spatial filtering) */
    hasBboxCovering() {
      if (!this.geoMetadata?.columns || !this.primaryGeoColumn) return false;
      const colMeta = this.geoMetadata.columns[this.primaryGeoColumn];
      return !!(colMeta?.covering?.bbox);
    },
    /** All geometry column names */
    geoColumns() {
      if (this.geoMetadata?.columns) return Object.keys(this.geoMetadata.columns);
      // Fallback: just the detected column
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
      // When viewport-filtered without an explicit count, use page fullness
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
      this.showLoad();
    }
  },
  methods: {
    // ── Modal management ──────────────────────────────────
    showModal(component, props = {}, events = {}, id = null) {
      this.modals.push({
        component,
        props,
        events,
        id: id || 'modal_' + Date.now()
      });
    },
    hideModal(modal) {
      const id = Utils.isObject(modal) ? modal.id : modal;
      const index = this.modals.findIndex((m) => m.id === id);
      if (index >= 0) this.modals.splice(index, 1);
    },
    showAboutModal() {
      this.showModal('AboutModal');
    },
    showLoad() {
      this.showModal(
        'LoadDataModal',
        { url: this.source || '' },
        {
          save: (url) => this.loadFromUrl(url),
          loadFile: (file) => this.loadFromFile(file)
        }
      );
    },
    showSchemaModal() {
      this.showModal('SchemaModal', {
        schema: this.schema,
        geoMetadata: this.geoMetadata
      });
    },
    showKvMetadata() {
      this.showModal('MetadataModal', {
        title: 'Key-Value Metadata',
        data: this.kvMetadata
      });
    },
    showGeoMetadata() {
      this.showModal('MetadataModal', {
        title: 'GeoParquet Metadata',
        data: this.geoMetadata
      });
    },
    showFileMetadata() {
      this.showModal('MetadataModal', {
        title: 'Parquet File Metadata',
        data: this.fileMetadata
      });
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
      // Update URL bar
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
      // Drop previously registered local file
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
        // Step 1: Initialize DuckDB
        this.setStatus('Initializing DuckDB...');
        await initDB((msg) => this.setStatus(msg));

        // Step 2: Get schema
        this.setStatus('Reading schema...');
        this.schema = await getSchema(this.source);

        // Step 3: Get row count
        this.setStatus('Counting rows...');
        this.totalRows = await getRowCount(this.source);

        // Step 4: Get KV metadata (includes GeoParquet 'geo' key)
        this.setStatus('Reading metadata...');
        try {
          this.kvMetadata = await getKVMetadata(this.source);
          if (this.kvMetadata.geo && typeof this.kvMetadata.geo === 'object') {
            this.geoMetadata = this.kvMetadata.geo;
          }
        } catch (e) {
          console.warn('Could not read KV metadata:', e.message);
        }

        // Step 5: Get file-level metadata
        try {
          this.fileMetadata = await getParquetFileMetadata(this.source);
        } catch (e) {
          console.warn('Could not read file metadata:', e.message);
        }

        // Step 6: Load first page of data
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
        // If the viewport changed while we were loading, reload with bbox
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
        await this.executeQuery(this.currentOffset, null); // null limit = load all
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
        // Reset data for new filter
        this.rows = [];
        this.features = [];
        this.currentOffset = 0;
        this.selectedIndex = null;

        // Get filtered count (respecting viewport bbox if coverings available)
        this.setStatus('Counting filtered rows...');
        this.filteredCount = await queryCount(
          this.source,
          this.filters,
          this.hasBboxCovering ? this.viewportBounds : null,
          this.primaryGeoColumn,
          this.sourceCrsString
        );

        // Load first page with filters
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
     * @param {number} offset - Starting row offset
     * @param {number|null} limit - Max rows (null = unlimited)
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
          // Always skip geometry columns in table data
          if (this.geoColumns.includes(name)) continue;
          const val = arrowRow[name];
          // Convert special types to plain values
          if (typeof val === 'bigint') {
            row[name] = Number(val);
          } else if (ArrayBuffer.isView(val)) {
            row[name] = `[binary ${val.byteLength}B]`;
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
              // Fallback: parse WKB from raw binary (only for WGS 84 data;
              // non-4326 CRS requires ST_Transform which needs the spatial extension)
              const wkb = arrowRow[geoCol];
              if (wkb instanceof Uint8Array || ArrayBuffer.isView(wkb)) {
                geometry = wkbToGeoJSON(wkb);
              }
            }
          } catch (e) {
            // Skip features with unparseable geometry
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

      // Append to existing data
      this.rows = [...this.rows, ...newRows];
      this.features = [...this.features, ...newFeatures];
      this.currentOffset = offset + arrowRows.length;
      this.lastPageFull = limit ? arrowRows.length >= limit : false;

      // Calculate bounds from features if this is the first load
      if (offset === 0 && this.features.length > 0) {
        // Prefer GeoParquet metadata bbox (only if in WGS 84 / no reprojection needed)
        const geoColMeta = this.geoMetadata?.columns?.[geoCol];
        if (!this.needsReprojection && geoColMeta?.bbox && geoColMeta.bbox.length >= 4) {
          const [minx, miny, maxx, maxy] = geoColMeta.bbox;
          this.mapBounds = [
            [minx, miny],
            [maxx, maxy]
          ];
        } else {
          // Compute bounds from (already reprojected) GeoJSON features
          this.mapBounds = computeBounds(this.features);
        }
      }
    },

    // ── Selection sync ────────────────────────────────────
    onTableSelect(index) {
      this.selectedIndex = index;
      // Zoom map to feature
      if (this.$refs.mapView) {
        this.$refs.mapView.zoomToFeature(index);
      }
    },

    onMapSelect(index) {
      this.selectedIndex = index;
      // TableView will auto-scroll via its watcher
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

        // Abort if a newer viewport change has occurred
        if (gen !== this.viewportGeneration) return;

        this.setStatus(
          `Loaded ${this.loadedCount.toLocaleString()} rows in viewport.`
        );
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

<style lang="scss">
@import 'maplibre-gl/dist/maplibre-gl.css';

* {
  box-sizing: border-box;
}
html,
body,
#app,
#viewer {
  height: 100%;
  margin: 0;
  padding: 0;
  font-family:
    -apple-system,
    BlinkMacSystemFont,
    'Segoe UI',
    Roboto,
    sans-serif;
  overflow: hidden;
}
#viewer {
  display: flex;
  flex-direction: column;
}

/* ── Buttons ─────────────────────────────────────────── */
.btn {
  padding: 4px 10px;
  font-size: 0.8rem;
  border: 1px solid #999;
  border-radius: 3px;
  background: #f0f0f0;
  cursor: pointer;
  white-space: nowrap;
  &:hover {
    background: #e0e0e0;
  }
  &:disabled {
    opacity: 0.5;
    cursor: default;
  }
}
.btn-sm {
  padding: 2px 8px;
  font-size: 0.75rem;
}
.btn-primary {
  background: #1976d2;
  color: white;
  border-color: #1565c0;
  &:hover {
    background: #1565c0;
  }
}
.btn-danger {
  background: #d32f2f;
  color: white;
  border-color: #c62828;
  &:hover {
    background: #c62828;
  }
}

/* ── Header ──────────────────────────────────────────── */
#header {
  background: #333;
  color: #fff;
  flex-shrink: 0;

  .row {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0 0.6rem;
  }

  .header-row {
    height: 2.2rem;
  }

  .title {
    margin: 0;
    font-size: 1.1rem;
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .header-actions {
    display: flex;
    gap: 0.3rem;
    .btn {
      background: #555;
      color: white;
      border-color: #666;
      &:hover {
        background: #666;
      }
    }
  }

  .sub-header {
    height: 1.8rem;
    background: #555;
    font-size: 0.8rem;
    justify-content: space-between;

    code {
      font-size: 0.78rem;
    }
    .row-counts {
      white-space: nowrap;
      color: #ccc;
    }
  }
}

/* ── Main layout ─────────────────────────────────────── */
#main {
  flex: 1;
  min-height: 0;
  display: flex;
}

#left-panel {
  width: 50%;
  min-width: 300px;
  display: flex;
  flex-direction: column;
  border-right: 2px solid #ccc;
}

#right-panel {
  flex: 1;
  min-width: 300px;
}

.load-more-bar {
  padding: 6px;
  text-align: center;
  border-top: 1px solid #ddd;
  background: #f8f8f8;
  display: flex;
  gap: 6px;
  justify-content: center;
}

/* ── Welcome screen ──────────────────────────────────── */
.welcome {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  width: 100%;
  color: #555;
  text-align: center;
  padding: 2rem;

  h2 {
    margin: 0 0 0.5rem;
    font-size: 1.5rem;
  }
  p {
    margin: 0.3em 0;
    max-width: 500px;
    line-height: 1.5;
  }
  .btn {
    margin-top: 1rem;
    font-size: 1rem;
    padding: 8px 20px;
  }
}

/* ── Status bar ──────────────────────────────────────── */
.status-bar {
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  height: 1.5rem;
  background: #333;
  color: #ccc;
  font-size: 0.75rem;
  display: flex;
  align-items: center;
  padding: 0 0.6rem;
  z-index: 500;

  &.error {
    background: #c62828;
    color: white;
  }
}

/* (LoadingSpinner is self-contained via scoped styles) */

/* ── Forms (used by modals) ──────────────────────────── */
form {
  .row {
    display: flex;
    margin: 0.25em 0;
  }
  label {
    width: 30%;
    display: flex;
    align-items: center;
  }
  .input {
    flex-grow: 1;
    display: flex;
  }
  .input input {
    flex-grow: 1;
  }
  input {
    padding: 0.3em;
  }
  input,
  button {
    margin: 3px;
  }
}

/* ── Responsive ──────────────────────────────────────── */
@media (max-width: 768px) {
  #main {
    flex-direction: column;
  }
  #left-panel {
    width: 100%;
    height: 50%;
    border-right: none;
    border-bottom: 2px solid #ccc;
  }
  #right-panel {
    height: 50%;
    min-width: unset;
  }
}
</style>
