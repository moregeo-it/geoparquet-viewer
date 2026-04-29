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
              <th>ID</th>
              <th>Column Name</th>
              <th>Type</th>
              <th>DuckDB Type</th>
              <th>Converted Type</th>
              <th>Logical Type</th>
              <th>Repetition</th>
              <th>Info</th>
            </tr>
          </thead>
          <tbody>
            <template v-for="node in visibleNodes" :key="node.id">
              <tr :class="{ 'bg-green-lighten-5': isGeoColumn(node.name) }">
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
                  <code v-if="node.logical_type">{{ node.logical_type }}</code>
                  <code v-else-if="node.converted_type && node.converted_type !== 'NONE'">{{
                    node.converted_type
                  }}</code>
                  <code v-else-if="node.type">{{ node.type }}</code>
                  <span v-else class="text-grey">—</span>
                </td>
                <td>
                  <span class="text-caption">{{ node.duckdb_type }}</span>
                </td>
                <td>
                  <span class="text-caption">{{ node.converted_type || '—' }}</span>
                </td>
                <td>
                  <span class="text-caption">{{ node.logical_type || '—' }}</span>
                </td>
                <td>
                  <span class="text-caption">{{ formatRepetition(node.repetition_type) }}</span>
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
    geoMetadata: { type: Object, default: null }
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
      if (!rep) return '';
      switch (rep) {
        case 'REQUIRED':
          return 'required';
        case 'OPTIONAL':
          return 'optional';
        case 'REPEATED':
          return 'repeated';
        default:
          return rep.toLowerCase();
      }
    }
  }
};
</script>
