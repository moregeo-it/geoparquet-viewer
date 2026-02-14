<template>
  <div class="table-wrapper">
    <div
      v-if="columns.length === 0"
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
      no-data-text="No data loaded"
      :row-props="rowProps"
      @click:row="onRowClick"
    >
      <template #headers="{ columns: cols }">
        <tr>
          <th
            v-for="col in cols"
            :key="col.key"
            class="text-caption bg-grey-lighten-3"
            :style="col.key === '__index' ? 'width: 60px; text-align: center' : ''"
          >
            <div class="font-weight-bold">{{ col.title }}</div>
            <div
              v-if="col.subtitle"
              class="text-grey font-weight-regular"
              style="font-size: 0.65rem"
            >
              {{ col.subtitle }}
            </div>
          </th>
        </tr>
      </template>

      <template #[`item.__index`]="{ value }">
        <span class="text-grey text-caption">{{ value + 1 }}</span>
      </template>
    </v-data-table-virtual>
  </div>
</template>

<script>
export default {
  name: 'TableView',
  props: {
    rows: { type: Array, default: () => [] },
    columns: { type: Array, default: () => [] },
    selectedIndex: { type: Number, default: null }
  },
  emits: ['select'],
  computed: {
    tableHeaders() {
      return [
        { title: '#', key: '__index', width: 60, sortable: false, align: 'center' },
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
      if (index !== null && index !== undefined) {
        this.$nextTick(() => this.scrollToRow(index));
      }
    }
  },
  methods: {
    onRowClick(event, { item }) {
      this.$emit('select', item.__index);
    },
    rowProps({ item }) {
      return {
        class: item.__index === this.selectedIndex ? 'bg-red-lighten-4' : '',
        style: 'cursor: pointer'
      };
    },
    scrollToRow(index) {
      const rowPosition = this.rows.findIndex((r) => r.__index === index);
      if (rowPosition < 0) return;
      const wrapper = this.$el?.querySelector('.v-table__wrapper');
      if (!wrapper) return;
      const rowTop = rowPosition * 30;
      const viewTop = wrapper.scrollTop;
      const viewBottom = viewTop + wrapper.clientHeight;
      if (rowTop < viewTop + 30 || rowTop + 30 > viewBottom - 30) {
        wrapper.scrollTop = rowTop - wrapper.clientHeight / 2 + 15;
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
</style>
