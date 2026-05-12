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
      :item-height="rowHeight"
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
            <a
              v-else-if="isUrl(col.subtitle, item[col.key])"
              :href="item[col.key]"
              target="_blank"
              rel="noopener noreferrer"
              class="cell-url"
              @click.stop
              >{{ item[col.key] }}</a
            >
            <span v-else-if="isFormattableTemporal(col.subtitle)">
              {{ item[col.key] }}
              <template v-if="formatTemporalValue(item[col.key], col.subtitle)">
                <br />
                <span class="text-grey font-italic cell-formatted-time">{{
                  formatTemporalValue(item[col.key], col.subtitle)
                }}</span>
              </template>
            </span>
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
      ),
      // Matches a cell value that is entirely a URL
      URL_RE: markRaw(/^https?:\/\/\S+$/i),
      // Column types that can contain plain string URLs
      STRING_TYPE_RE: markRaw(
        /^(varchar|text|string|char(\(\d+\))?|bpchar|clob|mediumtext|longtext)$/i
      ),
      // Temporal types that benefit from a formatted UTC representation below the raw value
      TEMPORAL_FORMATTABLE_RE: markRaw(
        /^(date|timestamp(tz|_s|_ms|_us|_ns)?(\s+with\s+time\s+zone)?)$/i
      )
    };
  },
  computed: {
    rowHeight() {
      return this.columns.some((col) => this.isFormattableTemporal(col.type)) ? 48 : 30;
    },
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
    },
    /** Returns true when the column is a string type and the cell value is entirely a URL. */
    isUrl(type, value) {
      return (
        this.STRING_TYPE_RE.test((type ?? '').trim()) &&
        typeof value === 'string' &&
        this.URL_RE.test(value.trim())
      );
    },
    /** Returns true for DATE / TIMESTAMP* column types that get a formatted UTC line. */
    isFormattableTemporal(type) {
      return this.TEMPORAL_FORMATTABLE_RE.test((type ?? '').trim());
    },
    /**
     * Parse a raw cell string value into a JS Date, taking the DuckDB column
     * type into account so the correct epoch unit is applied.
     *
     * DuckDB-WASM / Apache Arrow JS returns:
     *   DATE          → integer (days since Unix epoch)
     *   TIMESTAMP_S   → integer (seconds since epoch)
     *   TIMESTAMP_MS  → integer or Number (milliseconds since epoch)
     *   TIMESTAMP / TIMESTAMP_US / TIMESTAMPTZ → BigInt (microseconds since epoch)
     *   TIMESTAMP_NS  → BigInt (nanoseconds since epoch)
     *
     * All of those come through formatValue() as plain decimal strings.
     * ISO strings (e.g. "2023-07-31T00:00:00.000Z") are also handled for
     * any environment that already converts to Date before serialisation.
     */
    _parseTemporalToDate(rawValue, type) {
      if (!rawValue || rawValue === 'NULL') return null;
      const upperType = (type ?? '').toUpperCase().trim();

      // ── ISO string (Date object was serialised via toISOString()) ──────────
      if (/^\d{4}-\d{2}-\d{2}(T.*)?$/.test(rawValue)) {
        const candidate = rawValue.includes('T')
          ? new Date(rawValue)
          : new Date(rawValue + 'T00:00:00Z');
        if (!isNaN(candidate.getTime())) return candidate;
      }

      // ── Raw numeric epoch value from Arrow ────────────────────────────────
      if (/^-?\d+$/.test(rawValue)) {
        // Use Number() – safe for all practical epoch values (< 2^53 µs ≈ year 285,428)
        const n = Number(rawValue);
        if (isNaN(n)) return null;
        if (upperType === 'DATE') return new Date(n * 86_400_000); // days → ms
        if (upperType === 'TIMESTAMP_S') return new Date(n * 1_000); // s → ms
        if (upperType === 'TIMESTAMP_MS') return new Date(n); // already ms
        if (upperType === 'TIMESTAMP_NS') return new Date(Math.round(n / 1_000_000)); // ns → ms
        // TIMESTAMP, TIMESTAMP_US, TIMESTAMPTZ, TIMESTAMP WITH TIME ZONE:
        // DuckDB-WASM can expose these as µs (BigInt → string) or ms (number → string)
        // depending on the Parquet file's physical precision. Detect by magnitude:
        //   ≥ 1e13  → microseconds  (year 2001+ in µs ≈ 9.78×10^14)
        //   ≥ 1e10  → milliseconds  (year 2001+ in ms ≈ 9.78×10^11)
        //   ≥ 1e7   → seconds       (year 2001+ in s  ≈ 9.78×10^8)
        const absN = Math.abs(n);
        if (absN >= 1e13) return new Date(Math.round(n / 1_000)); // µs → ms
        if (absN >= 1e10) return new Date(n); // already ms
        if (absN >= 1e7) return new Date(n * 1_000); // s → ms
        return new Date(n * 86_400_000); // very small: treat as days
      }

      return null;
    },
    /**
     * Return a human-readable UTC string for a temporal cell value, or null
     * when parsing fails.  Examples:
     *   DATE          → "2023-07-25"
     *   TIMESTAMP     → "2023-07-31 12:34:56 UTC"
     *   TIMESTAMPTZ   → "2023-07-31 12:34:56.789 UTC"
     */
    formatTemporalValue(rawValue, type) {
      const d = this._parseTemporalToDate(rawValue, type);
      if (!d || isNaN(d.getTime())) return null;

      const upperType = (type ?? '').toUpperCase().trim();

      if (upperType === 'DATE') {
        return d.toISOString().slice(0, 10); // "YYYY-MM-DD"
      }

      // Full timestamp: "YYYY-MM-DD HH:mm:ss[.mmm] UTC"
      const iso = d.toISOString(); // always UTC, e.g. "2023-07-31T12:34:56.789Z"
      const datePart = iso.slice(0, 10);
      const timePart = iso.slice(11, 19);
      const ms = iso.slice(20, 23);
      return ms === '000' ? `${datePart} ${timePart} UTC` : `${datePart} ${timePart}.${ms} UTC`;
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
.cell-url {
  color: inherit;
  text-decoration: underline;
  text-decoration-color: rgba(var(--v-border-color), 0.5);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  display: block;
  max-width: 100%;
}
.cell-formatted-time {
  font-size: 0.7rem;
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
