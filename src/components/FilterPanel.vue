<template>
  <div class="filter-panel">
    <div class="filter-header">
      <span class="filter-title">Filters</span>
      <button class="btn btn-sm" @click="addFilter" title="Add filter">+ Add</button>
      <button
        v-if="localFilters.length > 0"
        class="btn btn-sm btn-danger"
        @click="clearFilters"
        title="Clear all filters"
      >
        Clear
      </button>
    </div>
    <div v-if="localFilters.length > 0" class="filter-rows">
      <div v-for="(filter, i) in localFilters" :key="i" class="filter-row">
        <select v-model="filter.column" class="filter-select filter-column">
          <option value="" disabled>Column...</option>
          <option v-for="col in columns" :key="col.name" :value="col.name">
            {{ col.name }}
          </option>
        </select>
        <select v-model="filter.operator" class="filter-select filter-operator">
          <option v-for="op in operators" :key="op.value" :value="op.value">
            {{ op.label }}
          </option>
        </select>
        <input
          v-if="!noValueOperators.includes(filter.operator)"
          v-model="filter.value"
          class="filter-input"
          placeholder="Value..."
          @keydown.enter="apply"
        />
        <button class="btn btn-sm btn-icon" @click="removeFilter(i)" title="Remove filter">
          &times;
        </button>
      </div>
      <div class="filter-actions">
        <button class="btn btn-sm btn-primary" @click="apply">Apply Filters</button>
      </div>
    </div>
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

<style scoped>
.filter-panel {
  border-bottom: 1px solid #ddd;
  background: #f8f8f8;
  padding: 6px 8px;
  font-size: 0.8rem;
}
.filter-header {
  display: flex;
  align-items: center;
  gap: 6px;
}
.filter-title {
  font-weight: 600;
  margin-right: 4px;
}
.filter-rows {
  margin-top: 6px;
}
.filter-row {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-bottom: 4px;
}
.filter-select {
  padding: 3px 4px;
  font-size: 0.78rem;
  border: 1px solid #ccc;
  border-radius: 3px;
  background: white;
}
.filter-column {
  min-width: 100px;
  max-width: 180px;
}
.filter-operator {
  width: 90px;
}
.filter-input {
  flex: 1;
  padding: 3px 6px;
  font-size: 0.78rem;
  border: 1px solid #ccc;
  border-radius: 3px;
  min-width: 60px;
}
.filter-actions {
  margin-top: 4px;
}
.btn-icon {
  width: 24px;
  height: 24px;
  padding: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 1rem;
  line-height: 1;
}
</style>
