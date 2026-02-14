<template>
  <div class="virtual-table-wrapper">
    <div v-if="columns.length === 0" class="empty-table">No columns to display</div>
    <div v-else class="virtual-table-scroller" ref="scroller" @scroll="onScroll">
      <table class="virtual-table">
        <thead>
          <tr>
            <th class="row-num-header">#</th>
            <th
              v-for="col in columns"
              :key="col.name"
              class="col-header"
              :title="`${col.name} (${col.type})`"
            >
              <span class="col-name">{{ col.name }}</span>
              <span class="col-type">{{ col.type }}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          <!-- Top spacer row -->
          <tr v-if="topPadding > 0" :style="{ height: topPadding + 'px' }">
            <td :colspan="columns.length + 1"></td>
          </tr>
          <!-- Visible rows -->
          <tr
            v-for="row in visibleRows"
            :key="row.__index"
            :class="{ selected: row.__index === selectedIndex }"
            @click="$emit('select', row.__index)"
          >
            <td class="row-num">{{ row.__index + 1 }}</td>
            <td v-for="col in columns" :key="`${row.__index}_${col.name}`">
              <div class="cell-content" :title="formatValue(row[col.name])">
                {{ formatValue(row[col.name]) }}
              </div>
            </td>
          </tr>
          <!-- Bottom spacer row -->
          <tr v-if="bottomPadding > 0" :style="{ height: bottomPadding + 'px' }">
            <td :colspan="columns.length + 1"></td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<script>
const ROW_HEIGHT = 30;
const BUFFER_ROWS = 20;

export default {
  name: 'TableView',
  props: {
    rows: { type: Array, default: () => [] },
    columns: { type: Array, default: () => [] },
    selectedIndex: { type: Number, default: null }
  },
  emits: ['select'],
  data() {
    return {
      scrollTop: 0,
      containerHeight: 400
    };
  },
  computed: {
    totalHeight() {
      return this.rows.length * ROW_HEIGHT;
    },
    startIndex() {
      return Math.max(0, Math.floor(this.scrollTop / ROW_HEIGHT) - BUFFER_ROWS);
    },
    endIndex() {
      const visibleCount = Math.ceil(this.containerHeight / ROW_HEIGHT);
      return Math.min(
        this.rows.length,
        Math.floor(this.scrollTop / ROW_HEIGHT) + visibleCount + BUFFER_ROWS
      );
    },
    topPadding() {
      return this.startIndex * ROW_HEIGHT;
    },
    bottomPadding() {
      return Math.max(0, (this.rows.length - this.endIndex) * ROW_HEIGHT);
    },
    visibleRows() {
      return this.rows.slice(this.startIndex, this.endIndex);
    }
  },
  watch: {
    selectedIndex(index) {
      if (index !== null && index !== undefined) {
        this.$nextTick(() => this.scrollToRow(index));
      }
    }
  },
  mounted() {
    this.measureContainer();
    this._resizeObserver = new ResizeObserver(() => this.measureContainer());
    if (this.$refs.scroller) {
      this._resizeObserver.observe(this.$refs.scroller);
    }
  },
  updated() {
    // When columns become available, the scroller ref appears — start observing it
    if (this.$refs.scroller && this._resizeObserver) {
      try {
        this._resizeObserver.observe(this.$refs.scroller);
      } catch {
        /* already observed */
      }
    }
  },
  beforeUnmount() {
    if (this._resizeObserver) {
      this._resizeObserver.disconnect();
    }
  },
  methods: {
    measureContainer() {
      if (this.$refs.scroller) {
        this.containerHeight = this.$refs.scroller.clientHeight;
      }
    },
    onScroll() {
      if (this.$refs.scroller) {
        this.scrollTop = this.$refs.scroller.scrollTop;
      }
    },
    scrollToRow(index) {
      const scroller = this.$refs.scroller;
      if (!scroller) return;
      // Find position of the row in the full data
      const rowPosition = this.rows.findIndex((r) => r.__index === index);
      if (rowPosition < 0) return;
      const rowTop = rowPosition * ROW_HEIGHT;
      const rowBottom = rowTop + ROW_HEIGHT;
      const viewTop = scroller.scrollTop;
      const viewBottom = viewTop + scroller.clientHeight;
      // Only scroll if the row is not visible
      if (rowTop < viewTop + ROW_HEIGHT || rowBottom > viewBottom - ROW_HEIGHT) {
        scroller.scrollTop = rowTop - scroller.clientHeight / 2 + ROW_HEIGHT / 2;
      }
    },
    formatValue(value) {
      if (value === null || value === undefined) return '';
      if (typeof value === 'bigint') return value.toString();
      if (value instanceof Date) return value.toISOString();
      if (ArrayBuffer.isView(value)) return `[binary ${value.byteLength}B]`;
      if (typeof value === 'object') {
        try {
          return JSON.stringify(value);
        } catch {
          return String(value);
        }
      }
      return String(value);
    }
  }
};
</script>

<style scoped>
.virtual-table-wrapper {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.virtual-table-scroller {
  flex: 1;
  overflow: auto;
  min-height: 0;
}
.empty-table {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: #999;
}
.virtual-table {
  width: 100%;
  border-collapse: collapse;
  table-layout: auto;
}
.virtual-table thead {
  position: sticky;
  top: 0;
  z-index: 2;
}
.virtual-table th {
  background: #e0e0e0;
  padding: 4px 8px;
  text-align: left;
  font-size: 0.78rem;
  border-bottom: 2px solid #999;
  border-right: 1px solid #ccc;
  white-space: nowrap;
  user-select: none;
}
.col-name {
  display: block;
  font-weight: 600;
}
.col-type {
  display: block;
  font-weight: 400;
  font-size: 0.65rem;
  color: #777;
}
.row-num-header {
  width: 3rem;
  text-align: center;
}
.row-num {
  text-align: center;
  color: #999;
  font-size: 0.7rem;
  background: #f5f5f5;
  border-right: 1px solid #ddd;
  min-width: 3rem;
}
.virtual-table td {
  padding: 2px 8px;
  font-size: 0.78rem;
  border-bottom: 1px solid #eee;
  border-right: 1px solid #f0f0f0;
  max-width: 250px;
}
.cell-content {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 250px;
}
.virtual-table tbody tr {
  cursor: pointer;
  height: 30px;
}
.virtual-table tbody tr:hover {
  background: #e8f0fe;
}
.virtual-table tbody tr.selected {
  background: #ffcccc !important;
}
.virtual-table tbody tr:nth-child(even):not(.selected):not(:hover) {
  background: #fafafa;
}
</style>
