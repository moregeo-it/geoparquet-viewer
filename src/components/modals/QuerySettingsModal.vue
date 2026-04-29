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
          Select which columns to load and display in the table. This is important as GeoParquet is
          a columnar format and more only loading the columns you need will improve load time and
          memory usage. The primary geometry column is always loaded and not shown here.
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
            size="medium"
            variant="text"
            v-if="localSelectedColumns.length < availableColumns.length"
            @click="selectAllColumns"
            >Select all</v-btn
          >
          <v-btn
            size="medium"
            variant="text"
            v-if="localSelectedColumns.length > 0"
            @click="deselectAllColumns"
            >Deselect all</v-btn
          >
        </div>

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
    defaults: { type: Object, default: () => ({}) }
  },
  emits: ['update:modelValue', 'apply', 'cancel'],
  data() {
    return {
      localSelectedColumns: [],
      localPageSize: 10000
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
    pageSizeOptions() {
      const rgs = this.defaults.rowGroupSize ?? null;

      const baseValues = [1000, 5000, 10000, 25000, 50000, 100000];

      // Inject rowGroupSize as its own option if it isn't already in the list
      const values = baseValues.includes(rgs) ? baseValues : [...baseValues, rgs].filter(Boolean);
      values.sort((a, b) => a - b);

      return values.map((value) => {
        const parts = [value.toLocaleString()]; //

        if (value === this.defaults.pageSize) {
          parts.push('default');
        }
        if (value === rgs) {
          parts.push('row group size');
        }
        if (rgs !== null && value > rgs) {
          parts.push('might be slow');
        }

        return { value, title: parts.join(' — ') };
      });
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
