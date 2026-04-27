<template>
  <v-dialog
    :model-value="modelValue"
    @update:model-value="$emit('update:modelValue', $event)"
    width="auto"
  >
    <v-card>
      <v-card-title class="d-flex align-center">
        About
        <v-spacer />
        <v-btn icon size="small" variant="text" @click="$emit('update:modelValue', false)">
          <v-icon>mdi-close</v-icon>
        </v-btn>
      </v-card-title>
      <v-divider />
      <v-card-text>
        <p class="mb-3">A performant GeoParquet Viewer for the Web.</p>
        <v-list density="compact" class="pa-0 mb-3">
          <v-list-item
            href="https://github.com/m-mohr/geoparquet-viewer"
            target="_blank"
            prepend-icon="mdi-github"
            title="Source code"
          />
          <v-list-item
            href="https://github.com/m-mohr/geoparquet-viewer/issues"
            target="_blank"
            prepend-icon="mdi-bug"
            title="Submit bug reports and enhancement proposals"
          />
        </v-list>
        <p class="mb-3">
          This project was implemented and is maintained by
          <a href="https://moregeo.it" target="_blank">moreGeo</a>
          with initial funding from <a href="https://ogc.org" target="_blank">OGC</a>.
        </p>
        <h3 class="text-subtitle-1 font-weight-bold mb-2">Built with</h3>
        <v-list density="compact" class="pa-0">
          <v-list-item>
            <a href="https://github.com/duckdb/duckdb-wasm" target="_blank">DuckDB-WASM</a>
            &mdash; In-browser SQL engine for Parquet reading, filtering, and range requests
          </v-list-item>
          <v-list-item>
            <a href="https://deck.gl" target="_blank">deck.gl</a>
            &mdash; GPU-accelerated map rendering
          </v-list-item>
          <v-list-item>
            <a href="https://maplibre.org" target="_blank">MapLibre GL JS</a>
            &mdash; Map basemap
          </v-list-item>
          <v-list-item>
            <a href="https://vuejs.org" target="_blank">Vue 3</a>
            +
            <a href="https://vuetifyjs.com" target="_blank">Vuetify</a>
            &mdash; UI framework
          </v-list-item>
        </v-list>
        <p class="mt-3">
          The project is generously hosted by
          <a href="https://github.com" target="_blank">GitHub</a>.
        </p>
      </v-card-text>
    </v-card>
  </v-dialog>
</template>

<script>
export default {
  name: 'AboutModal',
  props: {
    modelValue: { type: Boolean, default: false }
  },
  emits: ['update:modelValue']
};
</script>
