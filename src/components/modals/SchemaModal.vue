<template>
  <BaseModal width="70%" title="Schema">
    <table class="schema-table">
      <thead>
        <tr>
          <th>#</th>
          <th>Column</th>
          <th>Type</th>
          <th>Nullable</th>
          <th>Info</th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="(col, i) in schema"
          :key="col.name"
          :class="{ 'geo-column': isGeoColumn(col.name) }"
        >
          <td class="center">{{ i + 1 }}</td>
          <td>
            <strong>{{ col.name }}</strong>
            <span v-if="isPrimaryGeo(col.name)" class="badge">primary geometry</span>
            <span v-else-if="isGeoColumn(col.name)" class="badge badge-secondary">geometry</span>
          </td>
          <td><code>{{ col.type }}</code></td>
          <td class="center">{{ col.nullable ? 'Yes' : 'No' }}</td>
          <td>
            <template v-if="isGeoColumn(col.name)">
              <span v-if="getGeoInfo(col.name).encoding">
                {{ getGeoInfo(col.name).encoding }}
              </span>
              <span v-if="getGeoInfo(col.name).geometry_types?.length">
                ({{ getGeoInfo(col.name).geometry_types.join(', ') }})
              </span>
            </template>
          </td>
        </tr>
      </tbody>
    </table>
    <div v-if="geoMetadata" class="geo-summary">
      <h3>GeoParquet Info</h3>
      <table class="kv-table">
        <tbody>
        <tr>
          <td>Version</td>
          <td>{{ geoMetadata.version || 'unknown' }}</td>
        </tr>
        <tr>
          <td>Primary column</td>
          <td>{{ geoMetadata.primary_column }}</td>
        </tr>
        <tr v-if="crs">
          <td>CRS</td>
          <td>
            <code>{{ crsName }}</code>
          </td>
        </tr>
        <tr v-if="bbox">
          <td>Bounding Box</td>
          <td>{{ bbox.join(', ') }}</td>
        </tr>
        </tbody>
      </table>
    </div>
  </BaseModal>
</template>

<script>
import BaseModal from './BaseModal.vue';

export default {
  name: 'SchemaModal',
  components: {
    BaseModal
  },
  props: {
    schema: {
      type: Array,
      required: true
    },
    geoMetadata: {
      type: Object,
      default: null
    }
  },
  computed: {
    geoColumns() {
      return this.geoMetadata?.columns || {};
    },
    crs() {
      const primary = this.geoMetadata?.primary_column;
      return this.geoColumns[primary]?.crs || null;
    },
    crsName() {
      const crs = this.crs;
      if (!crs) return 'EPSG:4326 (default)';
      if (crs.id) return `${crs.id.authority}:${crs.id.code}`;
      if (crs.name) return crs.name;
      return JSON.stringify(crs);
    },
    bbox() {
      const primary = this.geoMetadata?.primary_column;
      return this.geoColumns[primary]?.bbox || null;
    }
  },
  methods: {
    isGeoColumn(name) {
      return name in this.geoColumns;
    },
    isPrimaryGeo(name) {
      return name === this.geoMetadata?.primary_column;
    },
    getGeoInfo(name) {
      return this.geoColumns[name] || {};
    }
  }
};
</script>

<style scoped>
.schema-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.85rem;
}
.schema-table th {
  background: #e0e0e0;
  padding: 6px 10px;
  text-align: left;
  border-bottom: 2px solid #999;
}
.schema-table td {
  padding: 5px 10px;
  border-bottom: 1px solid #eee;
}
.schema-table tr.geo-column {
  background: #e8f5e9;
}
.center {
  text-align: center;
}
code {
  background: #f0f0f0;
  padding: 1px 4px;
  border-radius: 3px;
  font-size: 0.82rem;
}
.badge {
  display: inline-block;
  background: #4caf50;
  color: white;
  padding: 1px 6px;
  border-radius: 8px;
  font-size: 0.7rem;
  margin-left: 6px;
  vertical-align: middle;
}
.badge-secondary {
  background: #78909c;
}
.geo-summary {
  margin-top: 1.5em;
}
.geo-summary h3 {
  margin: 0 0 0.5em;
  font-size: 1rem;
}
.kv-table {
  border-collapse: collapse;
  font-size: 0.85rem;
}
.kv-table td {
  padding: 3px 12px 3px 0;
}
.kv-table td:first-child {
  font-weight: 600;
  white-space: nowrap;
}
</style>
