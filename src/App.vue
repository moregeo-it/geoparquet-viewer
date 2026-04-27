<template>
  <v-app>
    <v-app-bar color="surface-variant" density="compact" flat>
      <v-app-bar-title >
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
        <div v-if="source">
          <v-toolbar density="compact" flat>
            <v-toolbar-title class="text-caption">
              {{ displaySource }}
            </v-toolbar-title>
            <span class="text-caption mr-3">
              <template v-if="filteredCount !== null && filteredCount !== totalRows">
                {{ filteredCount.toLocaleString() }} matched &middot;
              </template>
              {{ loadedCount.toLocaleString() }} loaded /
              {{ totalRows >= 0 ? totalRows.toLocaleString() : '?' }} total
            </span>
            <v-icon
              v-if="schema"
              size="small"
              variant="text"
              class="mr-3"
              @click="reopenQuerySettings"
            >
              mdi-cog
            </v-icon>
          </v-toolbar>
        </div>

        <vue-snotify />

        <div
          v-if="source"
          class="content-panels d-flex flex-grow-1"
          style="min-height: 0; position: relative"
        >
          <LoadingOverlay v-if="initialLoading" :message="statusMessage" />
          <div class="left-panel d-flex flex-column">
            <FilterPanel
              v-if="visibleColumns.length > 0"
              :columns="visibleColumns"
              :filters="filters"
              @apply="applyFilters"
            />
            <TableView
              :rows="rows"
              :columns="visibleColumns"
              :selectedIndex="selectedIndex"
              :loading="loading"
              @select="onTableSelect"
            />
            <div v-if="hasMore" class="d-flex justify-center ga-2 pa-1">
              <v-btn size="small" variant="outlined" @click="loadMore" :disabled="loading">
                Load more ({{ pageSize.toLocaleString() }} rows)
              </v-btn>
              <v-btn
                v-if="remainingRows > pageSize"
                size="small"
                variant="outlined"
                @click="confirmLoadAllIfLarge"
                :disabled="loading"
              >
                Load all remaining
              </v-btn>
            </div>
          </div>
          <div class="right-panel">
            <MapView
              ref="mapView"
              :geo-arrow-results="geoArrowResults"
              :selectedIndex="selectedIndex"
              :bounds="mapBounds"
              :wkb-by-index="wkbByIndex"
              :viewport-stale="viewportStale"
              :loading="loading"
              @select="onMapSelect"
              @viewportChange="onViewportChange"
              @reloadViewport="reloadForViewport"
            />
          </div>
        </div>

        <div
          v-else
          class="d-flex flex-column align-center justify-center flex-grow-1 text-center pa-8"
        >
          <h2 class="text-h5 mb-2">GeoParquet Viewer</h2>
          <p class="text-body-2 text-grey-darken-1 mb-1" style="max-width: 500px">
            Load a <a href="https://geoparquet.org" target="_blank">GeoParquet</a> file to visualize
            it on a map and explore the data in a table.
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

    <LoadDataModal
      v-model="loadDialogOpen"
      :url="source || ''"
      @save="loadFromUrl"
      @load-file="loadFromFile"
    />
    <SchemaModal v-model="schemaDialogOpen" :schema="schema || []" :geo-metadata="geoMetadata" />
    <MetadataModal
      v-model="metadataDialogOpen"
      :title="metadataDialogTitle"
      :data="metadataDialogData"
    />
    <AboutModal v-model="aboutDialogOpen" />
    <QuerySettingsModal
      v-model="querySettingsOpen"
      :schema="schema || []"
      :geo-columns="geoColumns"
      :total-rows="totalRows"
      :has-bbox-covering="hasBboxCovering"
      :defaults="querySettingsDefaults"
      @apply="applyQuerySettings"
    />

    <v-dialog v-model="confirmLoadAllOpen" max-width="420">
      <v-card>
        <v-card-title class="text-h6">Loading all remaining data?</v-card-title>
        <v-card-text class="text-body-2">
          There are <strong>{{ remainingRows.toLocaleString() }}</strong> rows left to load. This
          may take a while and could use significant memory.
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" @click="confirmLoadAllOpen = false">Cancel</v-btn>
          <v-btn
            color="primary"
            variant="flat"
            @click="
              confirmLoadAllOpen = false;
              loadAll();
            "
            >Load All</v-btn
          >
        </v-card-actions>
      </v-card>
    </v-dialog>
  </v-app>
</template>

<script>
import {
  initDB,
  registerLocalFile,
  dropFile,
  bootstrapMetadata,
  queryData,
  queryCount
} from './db.js';
import {
  buildGeoArrowTables,
  formatValue,
  toBinary,
  findGeoColumn
} from '@walkthru-earth/objex-utils';
import { friendlyError } from './utils.js';

import MapView from './components/MapView.vue';
import TableView from './components/TableView.vue';
import FilterPanel from './components/FilterPanel.vue';
import LoadingOverlay from './components/LoadingOverlay.vue';

import AboutModal from './components/modals/AboutModal.vue';
import LoadDataModal from './components/modals/LoadDataModal.vue';
import MetadataModal from './components/modals/MetadataModal.vue';
import SchemaModal from './components/modals/SchemaModal.vue';
import QuerySettingsModal from './components/modals/QuerySettingsModal.vue';

const DEFAULT_PAGE_SIZE = 10000;

function normalizeDisplayValue(value) {
  if (value === null || value === undefined) return value;
  if (ArrayBuffer.isView(value)) return `[binary ${value.byteLength}B]`;
  return formatValue(value);
}

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
    LoadingOverlay,
    AboutModal,
    LoadDataModal,
    MetadataModal,
    QuerySettingsModal,
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
      geoArrowResults: [],
      mapBounds: null,
      wkbByIndex: {},

      // Selection
      selectedIndex: null,

      // Filters
      filters: [],
      filteredCount: null,

      // Pagination
      pageSize: DEFAULT_PAGE_SIZE,
      rowGroupSize: null,
      currentOffset: 0,
      lastPageFull: false,

      // Viewport
      viewportBounds: null,
      viewportGeneration: 0,
      viewportStale: false,

      // UI state
      loading: false,
      statusMessage: '',

      // Query settings (user preferences applied before first query)
      selectedColumns: null,
      spatialFilterEnabled: true,

      // Dialog visibility
      loadDialogOpen: false,
      schemaDialogOpen: false,
      metadataDialogOpen: false,
      aboutDialogOpen: false,
      confirmLoadAllOpen: false,
      querySettingsOpen: false,

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
      return findGeoColumn(this.schema);
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
      // Also treat OGC:CRS84 as WGS84 (lon/lat, same as 4326 but axis-swapped; WKB always x,y)
      if (crs.id?.authority === 'OGC' && crs.id?.code === 'CRS84') return false;
      return true;
    },
    /**
     * Source CRS string for DuckDB ST_Transform.
     * Pass full PROJJSON because DuckDB-WASM spatial doesn't bundle the PROJ database
     * needed for EPSG code lookups (crashes with stoi: no conversion).
     */
    sourceCrsString() {
      if (!this.needsReprojection) return null;
      return JSON.stringify(this.primaryGeoCrs);
    },
    /** Whether the primary geo column has covering/bbox metadata */
    hasBboxCovering() {
      if (!this.geoMetadata?.columns || !this.primaryGeoColumn) return false;
      const colMeta = this.geoMetadata.columns[this.primaryGeoColumn];
      return !!colMeta?.covering?.bbox;
    },
    /**
     * Known geometry type for the primary column (e.g. 'point', 'polygon').
     * Derived from GeoParquet geometry_types. Returned only when all entries
     * resolve to a single base type (stripping Z/M/ZM). Passed to
     * buildGeoArrowTables to skip per-WKB type classification.
     */
    knownGeomType() {
      const col = this.primaryGeoColumn;
      const types = this.geoMetadata?.columns?.[col]?.geometry_types;
      if (!types || types.length === 0) return null;
      const baseTypes = new Set(types.map((t) => t.split(' ')[0].toLowerCase()));
      return baseTypes.size === 1 ? baseTypes.values().next().value : null;
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
    /** Columns visible to the user — filtered by selectedColumns when set */
    visibleColumns() {
      if (!this.selectedColumns) return this.nonGeoColumns;
      const selected = new Set(this.selectedColumns);
      return this.nonGeoColumns.filter((col) => selected.has(col.name));
    },
    /** Whether spatial viewport filtering is currently active */
    spatialFilterActive() {
      return this.hasBboxCovering && this.spatialFilterEnabled;
    },
    /** Defaults passed to the QuerySettingsModal */
    querySettingsDefaults() {
      const col = this.primaryGeoColumn;
      const colMeta = this.geoMetadata?.columns?.[col];
      const geomTypes = colMeta?.geometry_types;
      const geometryType = geomTypes?.length ? geomTypes.join(', ') : null;
      const crs = this.primaryGeoCrs;
      let crsLabel = 'WGS 84';
      if (crs) {
        if (crs.name) crsLabel = crs.name;
        else if (crs.id) crsLabel = `${crs.id.authority}:${crs.id.code}`;
      }
      return {
        selectedColumns: this.selectedColumns,
        pageSize: this.pageSize,
        rowGroupSize: this.rowGroupSize,
        spatialFilterEnabled: this.spatialFilterEnabled,
        geometryType,
        crsLabel
      };
    },
    /** True only during the very first load (no schema yet) */

    initialLoading() {
      return this.loading && !this.schema;
    },

    /** Number of rows currently loaded */
    loadedCount() {
      return this.rows.length;
    },
    /** Whether there are more rows to load */
    hasMore() {
      if (this.spatialFilterActive && this.viewportBounds && this.filteredCount === null) {
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
  watch: {},
  methods: {
    // ── Dialog helpers ─────────────────────────────────────
    openMetadataDialog(title, data) {
      this.metadataDialogTitle = title;
      this.metadataDialogData = data;
      this.metadataDialogOpen = true;
    },

    // ── Status & notifications ─────────────────────────────
    setStatus(msg) {
      this.statusMessage = msg;
    },

    setError(err) {
      this.statusMessage = '';
      const info = friendlyError(err);
      const body = [info.detail, info.suggestion].filter(Boolean).join('\n');
      this.$snotify.error(body, info.title, { timeout: 0, closeOnClick: true });
    },

    /**
     * Run an async task with snotify async toast.
     * Shows spinner while pending, transitions to success/error automatically.
     */
    _runTask(message, work) {
      this.loading = true;
      this.$snotify.async(message, () =>
        work()
          .then((successMsg) => {
            this.loading = false;
            return { body: successMsg, config: { timeout: 4000 } };
          })
          .catch((err) => {
            this.loading = false;
            console.error(err);
            const info = friendlyError(err);
            throw {
              title: info.title,
              body: [info.detail, info.suggestion].filter(Boolean).join('\n'),
              config: { timeout: 0, closeOnClick: true }
            };
          })
      );
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
      this.source = name;
      this.displaySource = file.name;
      this.loading = true;
      this.setStatus(`Reading file ${file.name} (${(file.size / 1024 / 1024).toFixed(1)} MB)...`);
      try {
        const buffer = await file.arrayBuffer();
        await registerLocalFile(name, buffer);
        this.localFileName = name;
        await this.loadData();
      } catch (e) {
        this.setError(e);
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
      this.geoArrowResults = [];
      this.mapBounds = null;
      this.wkbByIndex = {};
      this.mapFeatureCount = 0;
      this.selectedIndex = null;
      this.filters = [];
      this.filteredCount = null;
      this.currentOffset = 0;
      this.statusMessage = '';
      this.$snotify.clear();
      this.viewportStale = false;
      this.selectedColumns = null;
      this.spatialFilterEnabled = true;
    },

    async loadData() {
      this.loading = true;
      try {
        this.setStatus('Initializing DuckDB...');
        await initDB((msg) => this.setStatus(msg));

        // Single bootstrap: schema + row count + row group size + KV/geo/file metadata.
        const meta = await bootstrapMetadata(this.source, (msg) => this.setStatus(msg));
        this.schema = meta.schema;
        this.totalRows = meta.totalRows;
        this.kvMetadata = meta.kvMetadata;
        this.geoMetadata = meta.geoMetadata;
        this.fileMetadata = meta.fileMetadata;
        this.rowGroupSize = meta.rowGroupSize;

        // Pause: let the user choose columns, page size, etc.
        this.statusMessage = '';
        this.loading = false;
        this.querySettingsOpen = true;
      } catch (e) {
        console.error('Load error:', e);
        this.setError(e);
        this.loading = false;
      }
    },

    applyQuerySettings(settings) {
      this.selectedColumns = settings.selectedColumns;
      this.pageSize = settings.pageSize;
      this.spatialFilterEnabled = settings.spatialFilterEnabled;

      // Clear any previous data (relevant when re-opening settings)
      this.rows = [];
      this.geoArrowResults = [];
      this.wkbByIndex = {};
      this.mapBounds = null;
      this.currentOffset = 0;
      this.selectedIndex = null;
      this.filteredCount = null;
      this.filters = [];

      this._runTask('Loading data...', async () => {
        await this.executeQuery(0);
        return `Loaded ${this.loadedCount.toLocaleString()} of ${this.totalRows.toLocaleString()} rows.`;
      });
    },

    reopenQuerySettings() {
      this.querySettingsOpen = true;
    },

    loadMore() {
      if (!this.hasMore || this.loading) return;
      this._runTask('Loading more data...', async () => {
        await this.executeQuery(this.currentOffset);
        return `Loaded ${this.loadedCount.toLocaleString()} rows.`;
      });
    },

    confirmLoadAllIfLarge() {
      if (this.remainingRows > this.pageSize) {
        this.confirmLoadAllOpen = true;
      } else {
        this.loadAll();
      }
    },

    loadAll() {
      if (!this.hasMore || this.loading) return;
      this._runTask('Loading all remaining data...', async () => {
        await this.executeQuery(this.currentOffset, null);
        return `Loaded ${this.loadedCount.toLocaleString()} rows.`;
      });
    },

    applyFilters(newFilters) {
      this.filters = newFilters;
      this.rows = [];
      this.geoArrowResults = [];
      this.wkbByIndex = {};
      this.mapBounds = null;
      this.currentOffset = 0;
      this.selectedIndex = null;

      this._runTask('Applying filters...', async () => {
        this.filteredCount = await queryCount(
          this.source,
          this.filters,
          this.spatialFilterActive ? this.viewportBounds : null,
          this.primaryGeoColumn,
          this.sourceCrsString
        );
        await this.executeQuery(0);
        return `Filter matched ${this.filteredCount.toLocaleString()} rows. Showing ${this.loadedCount.toLocaleString()}.`;
      });
    },

    /**
     * Execute query and append results to rows and GeoArrow map data.
     */
    async executeQuery(offset, limit = this.pageSize) {
      // Build explicit column list: visible columns + geo column.
      // Avoids SELECT * which fetches bbox structs, binary blobs, etc.
      const tableColNames = this.visibleColumns.map((c) => c.name);
      const geoCol = this.primaryGeoColumn;
      const selectColumns = geoCol ? [...tableColNames, geoCol] : tableColNames;

      const result = await queryData(this.source, {
        geoColumn: geoCol,
        filters: this.filters,
        bbox: this.spatialFilterActive ? this.viewportBounds : null,
        sourceCrs: this.sourceCrsString,
        columns: selectColumns,
        limit,
        offset
      });

      const numRows = result.numRows;

      // ── Column-oriented extraction ─────────────────────
      // Get Arrow Vectors once — avoids per-row StructRow Proxy overhead.
      const geoColSet = new Set(this.geoColumns);
      const displayCols = [];
      for (const field of result.schema.fields) {
        if (field.name === '__wkb' || geoColSet.has(field.name)) continue;
        displayCols.push({ name: field.name, vector: result.getChild(field.name) });
      }

      // WKB vector: __wkb when spatial extension produced it, else raw geo column.
      const wkbFromSpatial = result.getChild('__wkb');
      const wkbVector = wkbFromSpatial ?? (geoCol ? result.getChild(geoCol) : null);

      const newRows = [];
      const mapWkbArrays = [];
      const newWkbByIndex = {};
      const mapIndices = [];

      for (let i = 0; i < numRows; i++) {
        const globalIndex = offset + i;

        // ── Build table row ────────────────────────────────
        const row = { __index: globalIndex };
        for (let c = 0; c < displayCols.length; c++) {
          row[displayCols[c].name] = normalizeDisplayValue(displayCols[c].vector.get(i));
        }
        newRows.push(row);

        // ── Collect map-ready WKB + attributes ──────────────
        if (wkbVector) {
          // Arrow Vector.get() returns Uint8Array for Binary columns (__wkb).
          // For raw geo column (no spatial ext), toBinary() normalises the BLOB.
          const wkb = wkbFromSpatial ? wkbVector.get(i) : toBinary(wkbVector.get(i));
          if (wkb) {
            newWkbByIndex[globalIndex] = wkb;
            mapWkbArrays.push(wkb);
            mapIndices.push(globalIndex);
          }
        }
      }

      this.rows.push(...newRows);

      if (mapWkbArrays.length > 0) {
        const attributes = new Map([['__index', { values: mapIndices, type: 'BIGINT' }]]);
        const geoArrowResults = buildGeoArrowTables(mapWkbArrays, attributes, this.knownGeomType);

        this.geoArrowResults = [...this.geoArrowResults, ...geoArrowResults];
        Object.assign(this.wkbByIndex, newWkbByIndex);
      }

      this.currentOffset = offset + numRows;
      this.lastPageFull = limit ? numRows >= limit : false;

      // Set map bounds on first load (skip if already set, e.g. viewport reload)
      if (offset === 0 && !this.mapBounds && this.geoArrowResults.length > 0) {
        const geoColMeta = this.geoMetadata?.columns?.[geoCol];
        if (!this.needsReprojection && geoColMeta?.bbox && geoColMeta.bbox.length >= 4) {
          const [minx, miny, maxx, maxy] = geoColMeta.bbox;
          this.mapBounds = [
            [minx, miny],
            [maxx, maxy]
          ];
        } else {
          const firstResult = this.geoArrowResults[0];
          if (firstResult) {
            const [minX, minY, maxX, maxY] = firstResult.bounds;
            this.mapBounds = [
              [minX, minY],
              [maxX, maxY]
            ];
          }
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
      if (!this.source || !this.spatialFilterActive) return;
      // Mark viewport as stale — user decides when to reload.
      if (this.rows.length > 0) {
        this.viewportStale = true;
      }
    },

    reloadForViewport() {
      this.viewportStale = false;
      const gen = ++this.viewportGeneration;
      this.rows = [];
      this.geoArrowResults = [];
      this.wkbByIndex = {};
      // Keep mapBounds — the map is already at the right viewport.
      this.currentOffset = 0;
      this.selectedIndex = null;

      this._runTask('Loading data in viewport...', async () => {
        await this.executeQuery(0);
        if (gen !== this.viewportGeneration) return '';
        return `Loaded ${this.loadedCount.toLocaleString()} rows in viewport.`;
      });
    }
  }
};
</script>

<style>
/* Snotify toast sizing */
.snotifyToast__title {
  font-size: 1.3em;
}
.snotifyToast__body {
  font-size: 0.85em;
}

.content-panels {
  height: calc(100vh - 48px - 48px); /* 100vh - appbar(48px) - toolbar(48px) */
  overflow: hidden;
}

.left-panel {
  width: 50%;
  min-width: 300px;
  border-right: 2px solid rgba(var(--v-border-color), var(--v-border-opacity));
  display: flex;
  flex-direction: column;
  overflow: hidden;
  height: 100%;
}

.table-wrapper {
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
  min-height: 0;
}

.right-panel {
  flex: 1;
  min-width: 300px;
  overflow: hidden;
  height: 100%;
}

@media (max-width: 768px) {
  .content-panels {
    flex-direction: column !important;
    height: calc(100vh - 48px - 48px);
  }
  .left-panel {
    width: 100% !important;
    height: 50%;
    border-right: none !important;
    border-bottom: 2px solid rgba(var(--v-border-color), var(--v-border-opacity));
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
  .right-panel {
    height: 50%;
    min-width: unset !important;
    overflow: hidden;
  }
  .table-wrapper {
    flex: 1;
    overflow-y: auto;
    overflow-x: hidden;
    min-height: 0;
  }
}
</style>
