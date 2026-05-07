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
        Schema
        <v-spacer />
        <v-btn icon size="small" variant="text" @click="$emit('update:modelValue', false)">
          <v-icon>mdi-close</v-icon>
        </v-btn>
      </v-card-title>
      <v-divider />
      <v-card-text class="pa-0">
        <v-table density="compact">
          <thead>
            <tr>
              <th rowspan="2">ID</th>
              <th rowspan="2">
                <span style="width: 20px; display: inline-block" />
                Column Name
              </th>
              <th rowspan="2">DuckDB Type</th>
              <th colspan="4" class="text-center">Parquet</th>
              <th rowspan="2">Info</th>
            </tr>
            <tr>
              <th>Primitive Type</th>
              <th>Converted Type</th>
              <th>Logical Type</th>
              <th>Repetition</th>
            </tr>
          </thead>
          <tbody>
            <template v-for="node in visibleNodes" :key="node.id">
              <tr
                :class="{
                  'bg-green-lighten-5': isGeoColumn(node.name) && !isDark,
                  'bg-grey-darken-1': isGeoColumn(node.name) && isDark
                }"
              >
                <td>{{ node.column_id }}</td>
                <td>
                  <span
                    :style="{ paddingLeft: node.depth * 20 + 'px' }"
                    class="d-inline-flex align-center"
                  >
                    <v-icon
                      v-if="node.hasChildren"
                      size="small"
                      class="mr-1"
                      @click="toggleNode(node.id)"
                    >
                      {{ expanded[node.id] ? 'mdi-chevron-down' : 'mdi-chevron-right' }}
                    </v-icon>
                    <span v-else class="mr-1" style="width: 20px; display: inline-block" />
                    <strong>{{ node.name }}</strong>
                    <v-chip
                      v-if="isPrimaryGeo(node.name)"
                      size="x-small"
                      color="success"
                      class="ml-2"
                    >
                      primary geometry
                    </v-chip>
                    <v-chip
                      v-else-if="isGeoColumn(node.name)"
                      size="x-small"
                      color="grey"
                      class="ml-2"
                    >
                      geometry
                    </v-chip>
                  </span>
                </td>
                <td>
                  <code>{{ node.duckdb_type }}</code>
                </td>
                <td>
                  <code>{{ node.type || '—' }}</code>
                </td>
                <td>
                  <code>{{ node.converted_type || '—' }}</code>
                </td>
                <td>
                  <code>{{ node.logical_type || '—' }}</code>
                </td>
                <td>
                  <code>{{ formatRepetition(node.repetition_type) }}</code>
                </td>
                <td>
                  <template v-if="isGeoColumn(node.name)">
                    <span v-if="getGeoInfo(node.name).encoding" class="text-caption mr-2">
                      {{ getGeoInfo(node.name).encoding }}
                    </span>
                    <span
                      v-if="getGeoInfo(node.name).geometry_types?.length"
                      class="text-caption mr-2"
                    >
                      {{ getGeoInfo(node.name).geometry_types.join(', ') }}
                    </span>
                    <span v-if="getGeoCrs(node.name)" class="text-caption">
                      {{ getGeoCrs(node.name) }}
                    </span>
                  </template>
                  <template
                    v-else-if="node.scale != null && node.precision != null && node.precision > 0"
                  >
                    <span class="text-caption"
                      >precision={{ node.precision }}, scale={{ node.scale }}</span
                    >
                  </template>
                </td>
              </tr>
            </template>
          </tbody>
        </v-table>
      </v-card-text>
    </v-card>
  </v-dialog>
</template>

<script>
export default {
  name: 'SchemaModal',
  props: {
    modelValue: { type: Boolean, default: false },
    parquetSchema: { type: Array, default: () => [] },
    geoMetadata: { type: Object, default: null },
    isDark: { type: Boolean, default: false }
  },
  emits: ['update:modelValue'],
  data() {
    return {
      expanded: {}
    };
  },
  computed: {
    tree() {
      if (!this.parquetSchema || this.parquetSchema.length === 0) return [];
      const rows = this.parquetSchema;
      let idx = 0;

      const buildChildren = (count, depth) => {
        const children = [];
        for (let i = 0; i < count && idx < rows.length; i++) {
          const row = rows[idx];
          idx++;
          const numChildren = row.num_children || 0;
          const node = {
            ...row,
            id: idx,
            depth,
            hasChildren: numChildren > 0,
            children: numChildren > 0 ? buildChildren(numChildren, depth + 1) : []
          };
          children.push(node);
        }
        return children;
      };

      // First row is the root message (schema root), skip it and use its num_children
      const root = rows[0];
      idx = 1;
      const rootChildren = root.num_children || 0;
      return buildChildren(rootChildren, 0);
    },
    visibleNodes() {
      const result = [];
      const walk = (nodes) => {
        for (const node of nodes) {
          result.push(node);
          if (node.hasChildren && this.expanded[node.id]) {
            walk(node.children);
          }
        }
      };
      walk(this.tree);
      return result;
    },
    geoColumns() {
      return this.geoMetadata?.columns || {};
    }
  },
  methods: {
    toggleNode(id) {
      this.expanded = { ...this.expanded, [id]: !this.expanded[id] };
    },
    isGeoColumn(name) {
      return name in this.geoColumns;
    },
    isPrimaryGeo(name) {
      return name === this.geoMetadata?.primary_column;
    },
    getGeoInfo(name) {
      return this.geoColumns[name] || {};
    },
    getGeoCrs(name) {
      const crs = this.geoColumns[name]?.crs;
      if (!crs) return null;
      if (crs.id) return `${crs.id.authority}:${crs.id.code}`;
      if (crs.name) return crs.name;
      return 'Custom CRS';
    },
    formatRepetition(rep) {
      if (typeof rep !== 'string') return '';
      return rep.toLowerCase();
    }
  }
};
</script>

<style scoped>
th {
  vertical-align: bottom;
}
.border-right {
  border-right: thin solid rgba(var(--v-border-color), var(--v-border-opacity));
}
</style>
