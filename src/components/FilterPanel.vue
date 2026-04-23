<template>
  <div class="pa-2 bg-grey-lighten-4" style="border-bottom: 1px solid #ddd">
    <div class="d-flex align-center ga-2">
      <span class="text-body-2 font-weight-bold">Filters</span>
      <v-btn size="x-small" variant="tonal" prepend-icon="mdi-plus" @click="addFilter">
        Add
      </v-btn>
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
        />
        <v-select
          v-model="filter.operator"
          :items="operators"
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
          density="compact"
          variant="outlined"
          hide-details
          placeholder="Value..."
          @keydown.enter="apply"
        />
        <v-btn icon size="x-small" variant="text" @click="removeFilter(i)">
          <v-icon>mdi-close</v-icon>
        </v-btn>
      </div>
      <div class="mt-1">
        <v-btn size="small" color="primary" variant="flat" @click="apply">
          Apply Filters
        </v-btn>
      </div>
    </template>
  </div>
</template>

<script>
const OPERATORS = [
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

const NO_VALUE_OPS = ['IS NULL', 'IS NOT NULL'];

export default {
  name: 'FilterPanel',
  props: {
    columns: { type: Array, default: () => [] },
    filters: { type: Array, default: () => [] }
  },
  emits: ['apply'],
  data() {
    return {
      localFilters: this.filters.length > 0 ? [...this.filters] : [],
      operators: OPERATORS,
      noValueOperators: NO_VALUE_OPS
    };
  },
  computed: {
    columnNames() {
      return this.columns.map((col) => col.name);
    }
  },
  watch: {
    filters: {
      handler(newFilters) {
        this.localFilters = newFilters.length > 0 ? [...newFilters] : [];
      },
      deep: true
    }
  },
  methods: {
    addFilter() {
      this.localFilters.push({
        column: this.columns.length > 0 ? this.columns[0].name : '',
        operator: '=',
        value: ''
      });
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
