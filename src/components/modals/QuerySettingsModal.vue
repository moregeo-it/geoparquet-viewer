<template>
  <v-dialog
    :model-value="modelValue"
    @update:model-value="$emit('update:modelValue', $event)"
    max-width="700"
    persistent
  >
    <v-card>
      <v-card-title>Query Preferences</v-card-title>
      <v-card-text>
        <!-- File summary -->
        <div class="d-flex ga-4 mb-4 text-body-2 text-grey-darken-1">
          <span>
            <strong>{{ totalRows >= 0 ? totalRows.toLocaleString() : '?' }}</strong> rows
          </span>
          <span>
            <strong>{{ availableColumns.length }}</strong> columns
          </span>
          <span v-if="geometryType">
            Geometry: <strong>{{ geometryType }}</strong>
          </span>
          <span v-if="crsLabel">
            CRS: <strong>{{ crsLabel }}</strong>
          </span>
        </div>

        <!-- Column picker -->
        <h3 class="text-subtitle-2 font-weight-bold mb-1">Columns</h3>
        <p class="text-caption text-grey-darken-1 mb-2">
          Select which columns to load and display in the table.
        </p>
        <div class="column-picker-list" :class="{ 'column-picker-list--tall': availableColumns.length > 10 }">
          <label
            v-for="col in availableColumns"
            :key="col.name"
            class="column-picker-item d-flex align-center ga-2 px-2 py-1"
          >
            <v-checkbox
              :model-value="localSelectedColumns.includes(col.name)"
              @update:model-value="toggleColumn(col.name, $event)"
              density="compact"
              hide-details
              class="flex-grow-0"
            />
            <span class="text-body-2">{{ col.name }}</span>
            <span class="text-caption text-grey ml-1">{{ col.type }}</span>
          </label>
        </div>
        <div class="d-flex ga-2 mt-2">
          <v-btn size="medium" variant="text" v-if="localSelectedColumns.length < availableColumns.length" @click="selectAllColumns">Select all</v-btn>
          <v-btn size="medium" variant="text" v-if="localSelectedColumns.length > 0" @click="deselectAllColumns">Deselect all</v-btn>
        </div>

        <v-divider class="my-4" />

        <!-- Page size -->
        <h3 class="text-subtitle-2 font-weight-bold mb-1">Rows per page</h3>
        <p class="text-caption text-grey-darken-1 mb-2">
          How many rows to load at a time. Smaller values load faster.
        </p>
        <v-select
          v-model="localPageSize"
          :items="pageSizeOptions"
          item-title="title"
          item-value="value"
          density="compact"
          variant="outlined"
          hide-details
          style="max-width: 280px"
        />

        <!-- Spatial filtering toggle -->
        <template v-if="hasBboxCovering">
          <v-divider class="my-4" />
          <h3 class="text-subtitle-2 font-weight-bold mb-1">Spatial filtering</h3>
          <v-switch
            v-model="localSpatialFilter"
            label="Filter data by map viewport"
            density="compact"
            hide-details
            color="primary"
          />
          <p class="text-caption text-grey-darken-1 mt-1">
            When enabled, only rows within the visible map area are loaded.
          </p>
        </template>
      </v-card-text>
      <v-card-actions>
        <span class="text-caption text-grey ml-2">
          {{ localSelectedColumns.length }} of {{ availableColumns.length }} columns selected
        </span>
        <v-spacer />
        <v-btn variant="text" @click="$emit('update:modelValue', false)">Cancel</v-btn>
        <v-btn
          color="primary"
          variant="flat"
          :disabled="localSelectedColumns.length === 0"
          @click="submit"
        >
          Load
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script>
export default {
  name: 'QuerySettingsModal',
  props: {
    modelValue: { type: Boolean, default: false },
    schema: { type: Array, default: () => [] },
    geoColumns: { type: Array, default: () => [] },
    totalRows: { type: Number, default: -1 },
    hasBboxCovering: { type: Boolean, default: false },
    defaults: { type: Object, default: () => ({}) }
  },
  emits: ['update:modelValue', 'apply'],
  data() {
    return {
      localSelectedColumns: [],
      localPageSize: 10000,
      localSpatialFilter: true
    };
  },
  computed: {
    /** Non-geo, non-internal columns available for selection */
    availableColumns() {
      const geoSet = new Set(this.geoColumns);
      return this.schema.filter(
        (col) => !geoSet.has(col.name) && !col.name.startsWith('__')
      );
    },
    /** Geometry type label from GeoParquet metadata */
    geometryType() {
      return this.defaults.geometryType || null;
    },
    /** CRS label */
    crsLabel() {
      return this.defaults.crsLabel || null;
    },
    /** Build page size options dynamically based on rowGroupSize */
    pageSizeOptions() {
      const rgs = this.defaults.rowGroupSize;

      // Base options with descriptions for larger values
      const baseOptions = [
        { value: 1000, title: '1,000', props: {} },
        { value: 5000, title: '5,000', props: {} },
        { value: 10000, title: '10,000 — default', props: {} },
        { value: 25000, title: '25,000 — may be slow', props: {} },
        { value: 50000, title: '50,000 — not recommended', props: {} }
      ];

      // If we have a rowGroupSize and it's >= 1000, add or replace in the list
      if (rgs && rgs >= 1000) {
        const existing = baseOptions.find((o) => o.value === rgs);
        if (existing) {
          // Row group size matches an existing option — annotate it
          existing.title = `${rgs.toLocaleString()} — row group size`;
        } else {
          // Insert row group size as a new option in sorted position
          baseOptions.push({
            value: rgs,
            title: `${rgs.toLocaleString()} — row group size`,
            props: {}
          });
          baseOptions.sort((a, b) => a.value - b.value);
        }
      }

      return baseOptions;
    }
  },
  watch: {
    modelValue(open) {
      if (open) this.initFromDefaults();
    }
  },
  methods: {
    initFromDefaults() {
      const d = this.defaults;
      const allNames = this.availableColumns.map((c) => c.name);

      // On first open (no previous selection), deselect all.
      // On re-open (user already picked columns), restore their selection.
      if (d.selectedColumns) {
        this.localSelectedColumns = d.selectedColumns.filter((n) => allNames.includes(n));
      } else {
        this.localSelectedColumns = [];
      }

      this.localPageSize = d.pageSize || 10000;
      this.localSpatialFilter = d.spatialFilterEnabled !== false;
    },
    selectAllColumns() {
      this.localSelectedColumns = this.availableColumns.map((c) => c.name);
    },
    deselectAllColumns() {
      this.localSelectedColumns = [];
    },
    toggleColumn(name, checked) {
      if (checked) {
        if (!this.localSelectedColumns.includes(name)) {
          this.localSelectedColumns.push(name);
        }
      } else {
        this.localSelectedColumns = this.localSelectedColumns.filter((n) => n !== name);
      }
    },
    submit() {
      this.$emit('apply', {
        selectedColumns: [...this.localSelectedColumns],
        pageSize: this.localPageSize,
        spatialFilterEnabled: this.localSpatialFilter
      });
      this.$emit('update:modelValue', false);
    }
  }
};
</script>

<style scoped>
.column-picker-list {
  border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
  border-radius: 4px;
  max-height: 200px;
  overflow-y: auto;
}
.column-picker-list--tall {
  max-height: 300px;
}
.column-picker-item:hover {
  background: rgba(var(--v-theme-on-surface), 0.08);
}
.column-picker-item .v-selection-control {
  min-height: unset;
}
</style>
