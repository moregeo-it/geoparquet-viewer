<template>
  <v-dialog
    :model-value="modelValue"
    @update:model-value="$emit('update:modelValue', $event)"
    width="90%"
    height="90%"
    scrollable
  >
    <v-card>
      <v-card-title class="d-flex align-center">
        Row Groups / Statistics
        <v-spacer />
        <v-btn icon size="small" variant="text" @click="$emit('update:modelValue', false)">
          <v-icon>mdi-close</v-icon>
        </v-btn>
      </v-card-title>
      <v-divider />
      <v-card-text v-if="loading" class="text-center pa-8">
        <v-progress-circular indeterminate color="primary" />
        <div class="mt-3 text-body-2 text-grey">Loading statistics...</div>
      </v-card-text>
      <v-card-text v-else-if="error" class="text-center pa-6 text-error">
        {{ error }}
      </v-card-text>
      <v-card-text v-else class="pa-0">
        <h4 class="text-subtitle-2 font-weight-bold pa-3 pb-1">Summary (all row groups)</h4>
        <v-table density="compact" class="stats-table mx-3 mb-3">
          <thead>
            <tr>
              <th>Column</th>
              <th>Type</th>
              <th>Compression</th>
              <th>Values</th>
              <th>Nulls</th>
              <th>Min</th>
              <th>Max</th>
              <th>Compressed</th>
              <th>Uncompressed</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="col in columnSummary" :key="col.name">
              <td class="font-weight-medium">{{ col.name }}</td>
              <td>
                <code>{{ col.types }}</code>
              </td>
              <td>{{ col.compressions }}</td>
              <td>{{ col.totalValues?.toLocaleString() }}</td>
              <td>{{ col.totalNulls != null ? col.totalNulls.toLocaleString() : '—' }}</td>
              <td class="text-caption">{{ formatStat(col.globalMin) }}</td>
              <td class="text-caption">{{ formatStat(col.globalMax) }}</td>
              <td>{{ formatBytes(col.totalCompressed) }}</td>
              <td>{{ formatBytes(col.totalUncompressed) }}</td>
            </tr>
          </tbody>
        </v-table>
        <v-divider />
        <h4 class="text-subtitle-2 font-weight-bold pa-3 pb-1">Row Groups</h4>

        <!-- Top pagination -->
        <v-pagination
          v-if="totalPages > 1"
          v-model="currentPage"
          :length="totalPages"
          :total-visible="totalVisible"
          density="compact"
          class="my-2"
        />

        <v-expansion-panels v-model="openPanel" variant="accordion">
          <v-expansion-panel v-for="group in pagedGroups" :key="group.id" :value="group.id">
            <v-expansion-panel-title>
              <strong>Row Group {{ group.id }}</strong>
              <span class="ml-2 text-caption text-grey">
                ({{ group.numRows.toLocaleString() }} rows, {{ group.columns.length }} columns)
              </span>
            </v-expansion-panel-title>
            <v-expansion-panel-text>
              <v-table v-if="openPanel === group.id" density="compact" class="stats-table">
                <thead>
                  <tr>
                    <th>Column</th>
                    <th>Type</th>
                    <th>Compression</th>
                    <th>Values</th>
                    <th>Nulls</th>
                    <th>Min</th>
                    <th>Max</th>
                    <th>Compressed</th>
                    <th>Uncompressed</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="col in group.columns" :key="col.column_id">
                    <td class="font-weight-medium">{{ col.path_in_schema }}</td>
                    <td>
                      <code>{{ col.type }}</code>
                    </td>
                    <td>{{ col.compression }}</td>
                    <td>{{ col.num_values?.toLocaleString() }}</td>
                    <td>
                      {{
                        col.stats_null_count != null ? col.stats_null_count.toLocaleString() : '—'
                      }}
                    </td>
                    <td class="text-caption">{{ formatStat(col.stats_min_value) }}</td>
                    <td class="text-caption">{{ formatStat(col.stats_max_value) }}</td>
                    <td>{{ formatBytes(col.total_compressed_size) }}</td>
                    <td>{{ formatBytes(col.total_uncompressed_size) }}</td>
                  </tr>
                </tbody>
              </v-table>
            </v-expansion-panel-text>
          </v-expansion-panel>
        </v-expansion-panels>

        <!-- Bottom pagination -->
        <v-pagination
          v-if="totalPages > 1"
          v-model="currentPage"
          :length="totalPages"
          :total-visible="totalVisible"
          density="compact"
          class="my-2"
        />
      </v-card-text>
    </v-card>
  </v-dialog>
</template>

<script>
import { markRaw } from 'vue';
import { queryParquetStats } from '../../db';

const PAGE_SIZE = 50;

export default {
  name: 'ParquetStatsModal',
  props: {
    modelValue: { type: Boolean, default: false },
    source: { type: String, default: '' }
  },
  emits: ['update:modelValue'],
  data() {
    return {
      loading: false,
      error: null,
      stats: null,
      openPanel: null,
      currentPage: 1,
      rowGroupsCache: null,
      columnSummaryCache: null
    };
  },
  computed: {
    rowGroups() {
      return this.rowGroupsCache ?? [];
    },
    columnSummary() {
      return this.columnSummaryCache ?? [];
    },
    totalPages() {
      return Math.ceil(this.rowGroups.length / PAGE_SIZE);
    },
    pagedGroups() {
      const start = (this.currentPage - 1) * PAGE_SIZE;
      return this.rowGroups.slice(start, start + PAGE_SIZE);
    },
    totalVisible() {
      return this.totalPages > 10 ? 10 : this.totalPages;
    }
  },
  watch: {
    modelValue(open) {
      if (open) {
        this.currentPage = 1;
        this.openPanel = null;
        if (!this.stats && !this.loading) this.fetchStats();
      }
    },
    source() {
      this.stats = null;
      this.openPanel = null;
      this.currentPage = 1;
      this.rowGroupsCache = null;
      this.columnSummaryCache = null;
      if (this.modelValue) this.fetchStats();
    },
    // Close open panel when user navigates to a different page,
    // since the previously open group.id won't exist in pagedGroups anymore.
    currentPage() {
      this.openPanel = null;
    }
  },
  methods: {
    async fetchStats() {
      this.loading = true;
      this.error = null;
      try {
        const raw = await queryParquetStats(this.source);
        this.stats = markRaw(raw);
        this.rowGroupsCache = markRaw(this.buildRowGroups(raw));
        this.columnSummaryCache = markRaw(this.buildColumnSummary(raw));
      } catch (e) {
        this.error = `Failed to load column statistics: ${e.message}`;
      } finally {
        this.loading = false;
      }
    },
    buildRowGroups(stats) {
      const groups = new Map();
      for (const row of stats) {
        const id = row.row_group_id;
        if (!groups.has(id)) {
          groups.set(id, { id, numRows: row.row_group_num_rows, columns: [] });
        }
        groups.get(id).columns.push(row);
      }
      return [...groups.values()];
    },
    buildColumnSummary(stats) {
      const map = new Map();
      for (const row of stats) {
        const name = row.path_in_schema;
        if (!map.has(name)) {
          map.set(name, {
            name,
            types: new Set(),
            compressions: new Set(),
            totalValues: 0,
            totalNulls: 0,
            hasNulls: false,
            globalMin: null,
            globalMax: null,
            totalCompressed: 0,
            totalUncompressed: 0
          });
        }
        const agg = map.get(name);
        if (row.type) agg.types.add(row.type);
        if (row.compression) agg.compressions.add(row.compression);
        if (row.num_values != null) agg.totalValues += row.num_values;
        if (row.stats_null_count != null) {
          agg.totalNulls += row.stats_null_count;
          agg.hasNulls = true;
        }
        if (row.total_compressed_size != null) agg.totalCompressed += row.total_compressed_size;
        if (row.total_uncompressed_size != null)
          agg.totalUncompressed += row.total_uncompressed_size;
        if (row.stats_min_value != null) {
          if (agg.globalMin == null || row.stats_min_value < agg.globalMin) {
            agg.globalMin = row.stats_min_value;
          }
        }
        if (row.stats_max_value != null) {
          if (agg.globalMax == null || row.stats_max_value > agg.globalMax) {
            agg.globalMax = row.stats_max_value;
          }
        }
      }
      return [...map.values()].map((agg) => ({
        name: agg.name,
        types: [...agg.types].join(', '),
        compressions: [...agg.compressions].join(', '),
        totalValues: agg.totalValues,
        totalNulls: agg.hasNulls ? agg.totalNulls : null,
        globalMin: agg.globalMin,
        globalMax: agg.globalMax,
        totalCompressed: agg.totalCompressed,
        totalUncompressed: agg.totalUncompressed
      }));
    },
    formatStat(val) {
      if (val == null) return '—';
      if (typeof val === 'string' && val.length > 30) return val.slice(0, 30) + '…';
      return String(val);
    },
    formatBytes(bytes) {
      if (bytes == null) return '—';
      if (bytes < 1024) return `${bytes} B`;
      if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
      return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    }
  }
};
</script>

<style scoped>
.stats-table {
  font-size: 0.8rem;
}
</style>
