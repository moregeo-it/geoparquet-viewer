<template>
  <div
    class="pa-2 filter-panel"
    style="border-bottom: 1px solid rgba(var(--v-border-color), var(--v-border-opacity))"
  >
    <div class="d-flex align-center ga-2">
      <span class="text-body-2 font-weight-bold">Filters</span>
      <v-btn size="x-small" variant="tonal" prepend-icon="mdi-plus" @click="addFilter"> Add </v-btn>
      <v-btn
        v-if="localFilters.length > 0"
        size="x-small"
        variant="tonal"
        color="error"
        @click="clearFilters"
      >
        Clear
      </v-btn>
    </div>
    <template v-if="localFilters.length > 0">
      <div v-for="(filter, i) in localFilters" :key="i" class="d-flex align-center ga-1 mt-1">
        <v-select
          v-model="filter.column"
          :items="columnNames"
          density="compact"
          variant="outlined"
          hide-details
          style="max-width: 180px"
          placeholder="Column..."
          @update:model-value="onColumnChange(filter)"
        />
        <v-select
          v-model="filter.operator"
          :items="operatorsForColumn(filter.column)"
          item-title="label"
          item-value="value"
          density="compact"
          variant="outlined"
          hide-details
          style="width: 110px; flex: 0 0 110px"
        />
        <v-text-field
          v-if="!noValueOperators.includes(filter.operator)"
          v-model="filter.value"
          :type="inputTypeForColumn(filter.column)"
          :error="filter.value === '' || filter.value == null"
          density="compact"
          variant="outlined"
          hide-details
          clearable
          placeholder="Value..."
          @keydown.enter="apply"
        />
        <v-btn icon size="x-small" variant="text" @click="removeFilter(i)">
          <v-icon>mdi-close</v-icon>
        </v-btn>
      </div>
      <div class="mt-2">
        <v-btn size="small" color="primary" variant="flat" :disabled="!canApply" @click="apply">
          Apply Filters
        </v-btn>
      </div>
    </template>
  </div>
</template>

<script>
const ALL_OPERATORS = [
  { value: '=', label: '=' },
  { value: '!=', label: '≠' },
  { value: '>', label: '>' },
  { value: '>=', label: '≥' },
  { value: '<', label: '<' },
  { value: '<=', label: '≤' },
  { value: 'LIKE', label: 'contains' },
  { value: 'IS NULL', label: 'is null' },
  { value: 'IS NOT NULL', label: 'is not null' }
];

const NUMERIC_OPERATORS = ['=', '!=', '>', '>=', '<', '<=', 'IS NULL', 'IS NOT NULL'];
const BOOLEAN_OPERATORS = ['=', '!=', 'IS NULL', 'IS NOT NULL'];

const NO_VALUE_OPS = ['IS NULL', 'IS NOT NULL'];

const NUMERIC_TYPES =
  /^(TINYINT|SMALLINT|INTEGER|INT|BIGINT|HUGEINT|FLOAT|REAL|DOUBLE|DECIMAL|NUMERIC|UTINYINT|USMALLINT|UINTEGER|UBIGINT)/i;
const BOOLEAN_TYPES = /^BOOLEAN/i;

function isNumericType(type) {
  return NUMERIC_TYPES.test(type);
}
function isBooleanType(type) {
  return BOOLEAN_TYPES.test(type);
}

export default {
  name: 'FilterPanel',
  props: {
    columns: { type: Array, default: () => [] },
    filters: { type: Array, default: () => [] }
  },
  emits: ['apply'],
  data() {
    return {
      localFilters: this.filters.map((f) => ({ ...f })),
      noValueOperators: NO_VALUE_OPS
    };
  },
  computed: {
    columnNames() {
      return this.columns.map((col) => col.name);
    },
    /** Map of column name → column type for quick lookup */
    columnTypeMap() {
      const map = {};
      for (const col of this.columns) map[col.name] = col.type;
      return map;
    },
    /** Whether every filter that requires a value has one */
    allFiltersComplete() {
      return this.localFilters.every(
        (f) => NO_VALUE_OPS.includes(f.operator) || (f.value !== '' && f.value != null)
      );
    },
    /** Whether local filters differ from the last-applied filters */
    filtersChanged() {
      if (this.localFilters.length !== this.filters.length) return true;
      return this.localFilters.some(
        (f, i) =>
          f.column !== this.filters[i].column ||
          f.operator !== this.filters[i].operator ||
          f.value !== this.filters[i].value
      );
    },
    /** Apply button should be enabled only when filters are complete AND changed */
    canApply() {
      return this.allFiltersComplete && this.filtersChanged;
    }
  },
  watch: {
    filters: {
      handler(newFilters) {
        this.localFilters = newFilters.map((f) => ({ ...f }));
      },
      deep: true
    }
  },
  methods: {
    /** Get available operators for a given column name */
    operatorsForColumn(colName) {
      const type = this.columnTypeMap[colName] || '';
      let allowed;
      if (isBooleanType(type)) {
        allowed = new Set(BOOLEAN_OPERATORS);
      } else if (isNumericType(type)) {
        allowed = new Set(NUMERIC_OPERATORS);
      } else {
        return ALL_OPERATORS;
      }
      return ALL_OPERATORS.filter((op) => allowed.has(op.value));
    },
    /** Get input type for a given column name */
    inputTypeForColumn(colName) {
      const type = this.columnTypeMap[colName] || '';
      if (isNumericType(type)) return 'number';
      return 'text';
    },
    addFilter() {
      this.localFilters.push({
        column: this.columns.length > 0 ? this.columns[0].name : '',
        operator: '=',
        value: ''
      });
    },
    onColumnChange(filter) {
      // Reset operator if it's not valid for the new column type
      const valid = this.operatorsForColumn(filter.column).map((o) => o.value);
      if (!valid.includes(filter.operator)) {
        filter.operator = '=';
      }
      filter.value = '';
    },
    removeFilter(index) {
      this.localFilters.splice(index, 1);
      if (this.localFilters.length === 0) {
        this.apply();
      }
    },
    clearFilters() {
      this.localFilters = [];
      this.apply();
    },
    apply() {
      this.$emit(
        'apply',
        this.localFilters.map((f) => ({ ...f }))
      );
    }
  }
};
</script>

<style scoped>
.filter-panel {
  background: rgb(var(--v-theme-surface));
}
</style>
