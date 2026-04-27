<template>
  <v-dialog
    :model-value="modelValue"
    @update:model-value="$emit('update:modelValue', $event)"
    width="auto"
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
      <v-card-text>
        <v-data-table
          :headers="headers"
          :items="schemaItems"
          density="compact"
          items-per-page="-1"
          :row-props="schemaRowProps"
        >
          <template #bottom />

          <template #[`item.name`]="{ value }">
            <strong>{{ value }}</strong>
            <v-chip v-if="isPrimaryGeo(value)" size="x-small" color="success" class="ml-2">
              primary geometry
            </v-chip>
            <v-chip v-else-if="isGeoColumn(value)" size="x-small" color="grey" class="ml-2">
              geometry
            </v-chip>
          </template>

          <template #[`item.type`]="{ value }">
            <code>{{ value }}</code>
          </template>

          <template #[`item.nullable`]="{ value }">
            {{ value ? 'Yes' : 'No' }}
          </template>

          <template #[`item.info`]="{ item }">
            <template v-if="isGeoColumn(item.name)">
              <span v-if="getGeoInfo(item.name).encoding">
                {{ getGeoInfo(item.name).encoding }}
              </span>
              <span v-if="getGeoInfo(item.name).geometry_types?.length">
                ({{ getGeoInfo(item.name).geometry_types.join(', ') }})
              </span>
            </template>
          </template>
        </v-data-table>

        <template v-if="geoMetadata">
          <h3 class="text-subtitle-1 font-weight-bold mt-4 mb-2">GeoParquet Info</h3>
          <v-table density="compact">
            <tbody>
              <tr>
                <td class="font-weight-bold" style="white-space: nowrap">Version</td>
                <td>{{ geoMetadata.version || 'unknown' }}</td>
              </tr>
              <tr>
                <td class="font-weight-bold" style="white-space: nowrap">Primary column</td>
                <td>{{ geoMetadata.primary_column }}</td>
              </tr>
              <tr v-if="crs">
                <td class="font-weight-bold" style="white-space: nowrap">CRS</td>
                <td>
                  <code>{{ crsName }}</code>
                </td>
              </tr>
              <tr v-if="bbox">
                <td class="font-weight-bold" style="white-space: nowrap">Bounding Box</td>
                <td>{{ bbox.join(', ') }}</td>
              </tr>
            </tbody>
          </v-table>
        </template>
      </v-card-text>
    </v-card>
  </v-dialog>
</template>

<script>
export default {
  name: 'SchemaModal',
  props: {
    modelValue: { type: Boolean, default: false },
    schema: { type: Array, required: true },
    geoMetadata: { type: Object, default: null }
  },
  emits: ['update:modelValue'],
  computed: {
    headers() {
      return [
        { title: '#', key: 'index', width: 50, sortable: false, align: 'center' },
        { title: 'Column', key: 'name', sortable: false },
        { title: 'Type', key: 'type', sortable: false },
        { title: 'Nullable', key: 'nullable', sortable: false, align: 'center' },
        { title: 'Info', key: 'info', sortable: false }
      ];
    },
    schemaItems() {
      return this.schema.map((col, i) => ({
        index: i + 1,
        name: col.name,
        type: col.type,
        nullable: col.nullable,
        info: ''
      }));
    },
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
    },
    schemaRowProps({ item }) {
      return {
        class: this.isGeoColumn(item.name) ? 'bg-green-lighten-5' : ''
      };
    }
  }
};
</script>
