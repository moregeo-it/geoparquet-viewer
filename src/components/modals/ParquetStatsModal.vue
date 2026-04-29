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
        <v-expansion-panels v-model="openPanel" variant="accordion">
          <v-expansion-panel v-for="(group, i) in rowGroups" :key="group.id" :value="i">
            <v-expansion-panel-title>
              <strong>Row Group {{ group.id }}</strong>
              <span class="ml-2 text-caption text-grey">
                ({{ group.numRows.toLocaleString() }} rows, {{ group.columns.length }} columns)
              </span>
            </v-expansion-panel-title>
            <v-expansion-panel-text>
              <v-table v-if="openPanel === i" density="compact" class="stats-table">
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
      </v-card-text>
    </v-card>
  </v-dialog>
</template>

<script>
import { markRaw } from 'vue';
import { queryParquetStats } from '../../db';

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
      openPanel: null
    };
  },
  computed: {
    rowGroups() {
      if (!this.stats) return [];
      const groups = new Map();
      for (const row of this.stats) {
        const id = row.row_group_id;
        if (!groups.has(id)) {
          groups.set(id, { id, numRows: row.row_group_num_rows, columns: [] });
        }
        groups.get(id).columns.push(row);
      }
      return [...groups.values()];
    }
  },
  watch: {
    modelValue(open) {
      if (open && !this.stats && !this.loading) {
        this.fetchStats();
      }
    }
  },
  methods: {
    async fetchStats() {
      this.loading = true;
      this.error = null;
      try {
        this.stats = markRaw(await queryParquetStats(this.source));
      } catch (e) {
        this.error = `Failed to load column statistics: ${e.message}`;
      } finally {
        this.loading = false;
      }
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
