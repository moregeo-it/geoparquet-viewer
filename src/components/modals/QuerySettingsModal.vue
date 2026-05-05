<template>
  <v-dialog
    :model-value="modelValue"
    @update:model-value="$emit('update:modelValue', $event)"
    min-width="480"
    width="50%"
    max-width="90%"
  >
    <v-card class="query-settings">
      <v-card-title>Data Loading Preferences</v-card-title>
      <v-divider />
      <v-card-text>
        <!-- File summary -->
        <div class="d-flex ga-4 mb-4 text-body-2 text-grey-darken-1">
          <span>
            <strong>{{ totalRows >= 0 ? totalRows.toLocaleString() : '?' }}</strong> rows
          </span>
          <span v-if="geometryType">
            Geometry: <strong>{{ geometryType }}</strong>
          </span>
          <span v-if="crsLabel">
            CRS: <strong>{{ crsLabel }}</strong>
          </span>
        </div>

        <!-- Column picker -->
        <h3 class="text-subtitle-2 font-weight-bold mb-1">
          Columns ({{ localSelectedColumns.length }}/{{ availableColumns.length }})
        </h3>
        <p class="text-caption text-grey-darken-1 my-1">
          Select which columns to load and display. This is important as GeoParquet is a columnar
          format and only loading the columns you need will improve load time and memory usage. The
          primary geometry column is always loaded.
        </p>
        <div
          class="column-picker-list"
          :class="{ 'column-picker-list--tall': availableColumns.length > 10 }"
        >
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
          <v-btn
            size="small"
            variant="text"
            v-if="localSelectedColumns.length < availableColumns.length"
            @click="selectAllColumns"
            >Select all</v-btn
          >
          <v-btn
            size="small"
            variant="text"
            v-if="localSelectedColumns.length > 0"
            @click="deselectAllColumns"
            >Deselect all</v-btn
          >
        </div>
        <template v-if="pageSizeOptions.length > 1">
          <v-divider class="my-4" />

          <!-- Page size -->
          <h3 class="text-subtitle-2 font-weight-bold mb-1">Rows per page</h3>
          <p class="text-caption text-grey-darken-1 my-2">
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
        </template>

        <!-- Inline warnings -->
        <template v-if="loadWarnings.length > 0">
          <v-divider class="my-4" />
          <v-alert
            v-for="(w, i) in loadWarnings"
            :key="i"
            :type="w.type"
            :icon="w.icon"
            variant="tonal"
            density="compact"
            class="mb-2 text-body-2"
          >
            {{ w.text }}
          </v-alert>
        </template>
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn variant="text" @click="cancel">Cancel</v-btn>
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
    defaults: { type: Object, default: () => ({}) },
    columnSizes: { type: Object, default: null }
  },
  emits: ['update:modelValue', 'apply', 'cancel'],
  data() {
    return {
      localSelectedColumns: [],
      localPageSize: null
    };
  },
  computed: {
    /** Non-geo, non-internal columns available for selection */
    availableColumns() {
      const geoSet = new Set(this.geoColumns);
      return this.schema.filter((col) => !geoSet.has(col.name) && !col.name.startsWith('__'));
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
    defaultPageSize() {
      return this.pageSizeOptions.find(o => o.title.includes('default'))?.value
        ?? this.defaults.pageSize;
    },
    pageSizeOptions() {
      const rgs = this.defaults.rowGroupSize ?? null;

      const baseValues = Array.from(
        new Set([
          1000,
          5000,
          10000,
          25000,
          50000,
          100000,
          this.defaults.rowGroupSize,
          this.totalRows
        ])
      )
        .filter((x) => typeof x === 'number' && x > 0 && x < this.totalRows && x < 1000000)
        .sort((a, b) => a - b);

      // Inject rowGroupSize as its own option if it isn't already in the list
      const values = baseValues.includes(rgs) ? baseValues : [...baseValues, rgs].filter(Boolean);
      values.sort((a, b) => a - b);

      // The default is the largest value strictly below rgs.
      // Falls back to this.defaults.pageSize when rgs is unknown.
      const defaultValue = rgs !== null
        ? (values.filter(v => v < rgs).at(-1) ?? values[0])
        : this.defaults.pageSize;

      return values.map((value) => {
        const parts = [value.toLocaleString()];

        if (value === defaultValue) {
          parts.push('default');
        }
        if (value === rgs) {
          parts.push('row group size');
        }
        if (rgs !== null && value > rgs) {
          parts.push('may load slower');
        }

        return { value, title: parts.join(' — ') };
      });
    },
    /** Inline warnings based on current selection */
    loadWarnings() {
      const warnings = [];
      const rgs = this.defaults.rowGroupSize;
      const numRowGroups = this.defaults.numRowGroups;

      // Row group size warning
      if (rgs && rgs > 100000) {
        warnings.push({
          icon: 'mdi-table-row',
          type: 'info',
          text: `Row group size is ${rgs.toLocaleString()} rows — each page load will fetch at least one full row group.`
        });
      }

      // Number of columns warning
      if (this.localSelectedColumns.length > 50) {
        warnings.push({
          icon: 'mdi-table-column',
          type: 'warning',
          text: `${this.localSelectedColumns.length} columns selected — consider selecting fewer for faster loading.`
        });
      }

      // Column compressed size warning
      if (this.columnSizes && this.localSelectedColumns.length > 0) {
        const totalBytes = this.selectedColumnsSize;
        if (totalBytes > 10 * 1024 * 1024) {
          warnings.push({
            icon: 'mdi-weight',
            type: 'warning',
            text: `Selected columns total ~${(totalBytes / 1024 / 1024).toFixed(1)} MB compressed per row group — loading may be slow.`
          });
        }
      }

      // Many row groups warning
      if (numRowGroups && numRowGroups > 1000) {
        warnings.push({
          icon: 'mdi-layers-outline',
          type: 'info',
          text: `File has ${numRowGroups.toLocaleString()} row groups — initial metadata parsing may be slow.`
        });
      }

      return warnings;
    },
    /** Sum of compressed sizes for currently selected columns (first row group) */
    selectedColumnsSize() {
      if (!this.columnSizes) return 0;
      let total = 0;
      for (const name of this.localSelectedColumns) {
        total += this.columnSizes[name] || 0;
      }
      // Always include geo column
      for (const geoCol of this.geoColumns) {
        total += this.columnSizes[geoCol] || 0;
      }
      return total;
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

      const match = this.pageSizeOptions.find((o) => o.value === this.defaultPageSize);
      if (match) {
        this.localPageSize = this.defaultPageSize;
      } else {
        // Pick the largest option that doesn't exceed the target, or the smallest available
        const below = this.pageSizeOptions.filter((o) => o.value <= this.defaultPageSize);
        this.localPageSize =
          below.length > 0
            ? below[below.length - 1].value
            : (this.pageSizeOptions[0]?.value ?? this.defaultPageSize);
      }
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
        pageSize: this.localPageSize
      });
      this.$emit('update:modelValue', false);
    },
    cancel() {
      this.$emit('update:modelValue', false);
      this.$emit('cancel');
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

.query-settings .text-caption {
  font-size: 0.9rem;
}
.query-settings h3 {
  margin-bottom: 0rem;
}
</style>
