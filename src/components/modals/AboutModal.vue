<template>
  <BaseModal width="50%" title="About">
    <p>A performant GeoParquet Viewer for the Web.</p>
    <ul>
      <li>
        <a href="https://github.com/m-mohr/geoparquet-viewer" target="_blank">Source code</a>
      </li>
      <li>
        <a href="https://github.com/m-mohr/geoparquet-viewer/issues" target="_blank">
          Submit bug reports and enhancement proposals
        </a>
      </li>
    </ul>
    <p>
      This project was implemented and is maintained by
      <a href="https://moregeo.it" target="_blank">moreGeo</a>
      with initial funding from <a href="https://ogc.org" target="_blank">OGC</a>.
    </p>
    <h3>Built with</h3>
    <ul>
      <li>
        <a href="https://github.com/duckdb/duckdb-wasm" target="_blank">DuckDB-WASM</a>
        &mdash; In-browser SQL engine for Parquet reading, filtering, and range requests
      </li>
      <li>
        <a href="https://deck.gl" target="_blank">deck.gl</a>
        &mdash; GPU-accelerated map rendering
      </li>
      <li>
        <a href="https://maplibre.org" target="_blank">MapLibre GL JS</a>
        &mdash; Map basemap
      </li>
      <li>
        <a href="https://vuejs.org" target="_blank">Vue 3</a>
        &mdash; UI framework
      </li>
    </ul>
    <p>
      The project is generously hosted by
      <a href="https://github.com" target="_blank">GitHub</a>.
    </p>
  </BaseModal>
</template>

<script>
import BaseModal from './BaseModal.vue';

export default {
  name: 'AboutModal',
  components: {
    BaseModal
  }
};
</script>
