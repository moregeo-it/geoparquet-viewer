<template>
  <div class="table-wrapper">
    <div
      v-if="columns.length === 0 && !loading"
      class="d-flex align-center justify-center fill-height text-grey"
    >
      No columns to display
    </div>
    <v-data-table-virtual
      v-else
      ref="table"
      :headers="tableHeaders"
      :items="rows"
      item-value="__index"
      :item-height="30"
      density="compact"
      fixed-header
      hover
      :loading="loading && columns.length !== 0"
      no-data-text="No data loaded"
      :row-props="rowProps"
      @click:row="onRowClick"
    >
      <template #headers="{ columns: cols }">
        <tr>
          <th
            v-for="col in cols"
            :key="col.key"
            class="text-caption table-header"
            :style="col.key === '__index' ? 'width: 60px; text-align: center' : ''"
          >
            <div class="font-weight-bold">{{ col.title }}</div>
            <div
              v-if="col.subtitle"
              class="text-grey font-weight-regular subtype"
              :title="col.subtitle"
            >
              {{ col.subtitle }}
            </div>
          </th>
        </tr>
      </template>

      <template #item="{ item, columns: cols }">
        <tr v-bind="rowProps({ item })" @click="onRowClick($event, { item })">
          <td
            v-for="col in cols"
            :key="col.key"
            :class="{
              'text-center': item[col.key] === null || item[col.key] === undefined,
              'text-right': col.key === '__index' || NUMERIC_TYPE_RE.test(col.subtitle ?? '')
            }"
          >
            <span v-if="col.key === '__index'" class="text-grey text-caption">{{
              item.__index + 1
            }}</span>
            <span
              v-else-if="item[col.key] === null || item[col.key] === undefined"
              class="text-grey text-caption font-italic"
              >n/a</span
            >
            <span v-else>{{ item[col.key] }}</span>
          </td>
        </tr>
      </template>
    </v-data-table-virtual>
  </div>
</template>

<script>
import { markRaw } from 'vue';

export default {
  name: 'TableView',
  props: {
    rows: { type: Array, default: () => [] },
    columns: { type: Array, default: () => [] },
    selectedIndex: { type: Number, default: null },
    loading: { type: Boolean, default: false },
    isDark: { type: Boolean, default: false }
  },
  emits: ['select'],
  data() {
    return {
      NUMERIC_TYPE_RE: markRaw(
        /^u?(tinyint|smallint|integer|bigint|hugeint|int\d*|float|double|real|decimal|numeric)(\([\d,\s]*\))?$/i
      )
    };
  },
  computed: {
    tableHeaders() {
      return [
        { title: '', key: '__index', width: 60, sortable: false, align: 'center' },
        ...this.columns.map((col) => ({
          title: col.name,
          subtitle: col.type,
          key: col.name,
          sortable: false,
          maxWidth: 250
        }))
      ];
    }
  },
  watch: {
    selectedIndex(index) {
      if (index !== null && index !== undefined && !this._clickedFromTable) {
        this.$nextTick(() => this.scrollToRow(index));
      }
      this._clickedFromTable = false;
    }
  },
  methods: {
    onRowClick(event, { item }) {
      this._clickedFromTable = true;
      this.$emit('select', item.__index === this.selectedIndex ? null : item.__index);
    },
    rowProps({ item }) {
      return {
        class:
          item.__index === this.selectedIndex
            ? this.isDark
              ? 'selected-row-dark'
              : 'selected-row-light'
            : '',
        style: 'cursor: pointer'
      };
    },
    scrollToRow(index) {
      const rowPosition = this.rows.findIndex((r) => r.__index === index);
      if (rowPosition < 0) return;
      if (this.$refs.table?.scrollToIndex) {
        this.$refs.table.scrollToIndex(rowPosition);
      }
    }
  }
};
</script>

<style scoped>
.table-wrapper {
  flex: 1;
  min-height: 0;
  overflow: hidden;
}
.table-wrapper :deep(.v-data-table) {
  height: 100%;
}
.table-wrapper :deep(.v-data-table__td) {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  font-size: 0.78rem;
}
.table-header {
  background: rgb(var(--v-theme-surface));
  border-bottom: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
}
.subtype {
  font-size: 0.65rem;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 75px;
  min-width: 100%;
}
</style>

<style>
.selected-row-light {
  background-color: rgba(255, 152, 0, 0.18) !important;
}
.selected-row-dark {
  background-color: rgba(255, 183, 77, 0.25) !important;
}
</style>
