<template>
  <div class="table-wrapper" :style="{ '--cell-max-height': itemHeight - 8 + 'px' }">
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
      :item-height="itemHeight"
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
            <div v-else class="cell-content">
              <span
                v-if="item[col.key] === null || item[col.key] === undefined"
                class="text-grey text-caption font-italic"
                >n/a</span
              >
              <a
                v-else-if="isUrlValue(item[col.key])"
                :href="item[col.key]"
                target="_blank"
                rel="noopener noreferrer"
                class="cell-link"
                @click.stop
                >{{ item[col.key] }}</a
              >
              <template v-else-if="TEMPORAL_TYPE_RE.test(col.subtitle ?? '')">
                <span class="d-block">{{
                  formatTemporalDisplay(item[col.key], col.subtitle)
                }}</span>
                <span class="d-block text-grey text-caption raw-temporal-value">{{
                  item[col.key]
                }}</span>
              </template>
              <span v-else-if="COMPLEX_TYPE_RE.test(col.subtitle ?? '')" class="complex-value">{{
                formatComplexDisplay(item[col.key])
              }}</span>
              <span v-else>{{ item[col.key] }}</span>
            </div>
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
      ),
      TEMPORAL_TYPE_RE: markRaw(
        /^(date|time(\s+with\s+time\s+zone)?|timestamp(\s+with\s+time\s+zone)?|timestamp_s|timestamp_ms|timestamp_ns|timestamptz|timestamp_tz|interval)(\([\d,\s]*\))?$/i
      ),
      // Matches array types (ends with []), STRUCT(...) and MAP(...) types
      COMPLEX_TYPE_RE: markRaw(/(\[\])+$|^(struct|map)\s*\(/i)
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
          sortable: false
        }))
      ];
    },
    hasTemporalColumns() {
      return this.columns.some((col) => this.TEMPORAL_TYPE_RE.test(col.type ?? ''));
    },
    hasComplexColumns() {
      return this.columns.some((col) => this.COMPLEX_TYPE_RE.test(col.type ?? ''));
    },
    itemHeight() {
      if (this.hasComplexColumns) return 72;
      if (this.hasTemporalColumns) return 48;
      return 30;
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
    },
    isUrlValue(value) {
      if (typeof value !== 'string') return false;
      const trimmed = value.trim();
      return trimmed.startsWith('http://') || trimmed.startsWith('https://');
    },
    formatTemporalDisplay(value, colType) {
      if (!value || value === 'NULL') return value;
      const type = (colType ?? '')
        .toUpperCase()
        .trim()
        .replace(/\(.*\)/, '')
        .trim();

      const isDateOnly = type === 'DATE';
      const isTimeOnly = type === 'TIME' || type === 'TIME WITH TIME ZONE';

      // ISO datetime string — Arrow Date objects get serialised to ISO strings by formatValue()
      if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value)) {
        const date = new Date(value);
        if (isNaN(date.getTime())) return value;
        if (isDateOnly) {
          return (
            date.toLocaleDateString(undefined, {
              year: 'numeric',
              month: '2-digit',
              day: '2-digit',
              timeZone: 'UTC'
            }) + ' UTC'
          );
        }
        if (isTimeOnly) {
          return (
            date.toLocaleTimeString(undefined, {
              hour: '2-digit',
              minute: '2-digit',
              second: '2-digit',
              timeZone: 'UTC'
            }) + ' UTC'
          );
        }
        return (
          date.toLocaleString(undefined, {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            timeZone: 'UTC'
          }) + ' UTC'
        );
      }

      // Numeric string — Arrow JS pre-converts all Timestamp/Date types to milliseconds:
      //   DateDay        → days × 86400000           (ms, always midnight UTC)
      //   TimestampS     → seconds × 1000            (ms)
      //   TimestampMs    → value as-is               (ms)
      //   TimestampMicro → microseconds ÷ 1000       (ms)
      //   TimestampNano  → nanoseconds ÷ 1000000     (ms)
      // TIME/TIMETZ is the sole exception: Arrow returns raw microseconds since midnight as bigint.
      if (typeof value === 'string' && /^-?\d+(\.\d+)?$/.test(value)) {
        if (isTimeOnly) {
          // Direct arithmetic avoids Date() timezone conversion for time-of-day values
          const totalSecs = Math.floor(Number(value) / 1_000_000);
          const h = Math.floor(totalSecs / 3600);
          const m = Math.floor((totalSecs % 3600) / 60);
          const s = totalSecs % 60;
          return (
            `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` +
            ' UTC'
          );
        }

        // Value is already milliseconds — pass directly to Date
        const dateMs = Number(value);
        if (!isNaN(dateMs)) {
          const date = new Date(dateMs);
          if (!isNaN(date.getTime())) {
            if (isDateOnly) {
              return (
                date.toLocaleDateString(undefined, {
                  year: 'numeric',
                  month: '2-digit',
                  day: '2-digit',
                  timeZone: 'UTC'
                }) + ' UTC'
              );
            }
            return (
              date.toLocaleString(undefined, {
                year: 'numeric',
                month: '2-digit',
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
                timeZone: 'UTC'
              }) + ' UTC'
            );
          }
        }
      }

      return value;
    },
    formatComplexDisplay(value) {
      if (!value || value === 'NULL') return value;
      let parsed;
      try {
        parsed = JSON.parse(value);
      } catch {
        return value;
      }
      if (Array.isArray(parsed)) {
        // Format array as [item1, item2, ...] with spaces for readability
        const items = parsed.map((v) => {
          if (v === null) return 'null';
          if (typeof v === 'object') return JSON.stringify(v);
          return String(v);
        });
        return '[' + items.join(', ') + ']';
      }
      if (parsed !== null && typeof parsed === 'object') {
        // Format struct/map as key: value pairs (one per line)
        return Object.entries(parsed)
          .map(([k, v]) => {
            if (v === null) return `${k}: null`;
            if (typeof v === 'object') return `${k}: ${JSON.stringify(v)}`;
            return `${k}: ${v}`;
          })
          .join('\n');
      }
      return value;
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
.cell-content {
  overflow-y: auto;
  overflow-x: hidden;
  max-height: var(--cell-max-height, 22px);
  word-break: break-word;
  overflow-wrap: anywhere;
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
.cell-link {
  color: inherit;
  text-decoration: underline;
  text-underline-offset: 2px;
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.complex-value {
  white-space: pre-wrap;
  font-family: inherit;
}
.raw-temporal-value {
  font-size: 0.7rem;
  opacity: 0.6;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
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
