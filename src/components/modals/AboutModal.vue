<template>
  <v-dialog
    :model-value="modelValue"
    @update:model-value="$emit('update:modelValue', $event)"
    max-width="750px"
    scrollable
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
        <p class="mb-3">A performant open-source (Geo)Parquet Viewer for the Web.</p>
        <p class="mb-3">
          This project was implemented and is maintained by
          <a href="https://moregeo.it" target="_blank">moreGeo</a>
          with initial funding from <a href="https://ogc.org" target="_blank">OGC</a>.
        </p>
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
            title="Submit bug reports and feature requests"
          />
          <v-list-item
            href="https://github.com/moregeo-it/geoparquet-viewer/discussions"
            target="_blank"
            prepend-icon="mdi-forum"
            title="Discussions and showcase"
          />
        </v-list>
        <p class="mb-3">
          Under the hood, this viewer uses DuckDB WASM for efficient Parquet reading and filtering,
          and deck.gl + MapLibre GL JS for GPU-accelerated map rendering.
        </p>
        <p class="mb-3">DuckDB version: {{ duckdbVersion }}</p>
      </v-card-text>
    </v-card>
  </v-dialog>
</template>

<script>
import { getDuckDBVersion } from '@/db.js';

export default {
  name: 'AboutModal',
  props: {
    modelValue: { type: Boolean, default: false }
  },
  emits: ['update:modelValue'],
  data() {
    return {
      duckdbVersion: ''
    };
  },
  async mounted() {
    try {
      this.duckdbVersion = await getDuckDBVersion();
    } catch (error) {
      console.log(error);
      this.duckdbVersion = 'unknown';
    }
  }
};
</script>
