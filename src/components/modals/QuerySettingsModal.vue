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
        <div class="d-flex ga-2 mb-2">
          <v-btn size="medium" variant="text" v-if="localSelectedColumns.length < availableColumns.length" @click="selectAllColumns">Select all</v-btn>
          <v-btn size="medium" variant="text" v-if="localSelectedColumns.length > 0" @click="deselectAllColumns">Deselect all</v-btn>
        </div>
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

        <v-divider class="my-4" />

        <!-- Page size -->
        <h3 class="text-subtitle-2 font-weight-bold mb-1">Rows per page</h3>
        <p class="text-caption text-grey-darken-1 mb-2">
          How many rows to load at a time. Smaller values load faster.
        </p>
        <v-select
          v-model="localPageSize"
          :items="pageSizeOptions"
          density="compact"
          variant="outlined"
          hide-details
          style="max-width: 200px"
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
      localSpatialFilter: true,
      pageSizeOptions: [
        { title: '1,000', value: 1000 },
        { title: '5,000', value: 5000 },
        { title: '10,000', value: 10000 },
        { title: '25,000', value: 25000 },
        { title: '50,000', value: 50000 }
      ]
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
      this.localSelectedColumns = d.selectedColumns
        ? d.selectedColumns.filter((n) => allNames.includes(n))
        : [...allNames];
      this.localPageSize = d.pageSize || 10000;
      this.localSpatialFilter = d.spatialFilterEnabled !== false;

      // Ensure the default page size is in the options list
      if (!this.pageSizeOptions.some((o) => o.value === this.localPageSize)) {
        this.pageSizeOptions = [
          ...this.pageSizeOptions,
          { title: this.localPageSize.toLocaleString(), value: this.localPageSize }
        ].sort((a, b) => a.value - b.value);
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
  border: 1px solid #e0e0e0;
  border-radius: 4px;
  max-height: 200px;
  overflow-y: auto;
}
.column-picker-list--tall {
  max-height: 300px;
}
.column-picker-item:hover {
  background: #f5f5f5;
}
.column-picker-item .v-selection-control {
  min-height: unset;
}
</style>
