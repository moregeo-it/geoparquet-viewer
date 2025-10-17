<template>
  <div id="viewer">
    <header id="header">
      <div class="row">
        <h1 class="title">GeoParquet Viewer (experimental)</h1>
        <button @click="showLoad">Load Data</button>
        <button @click="showAbout">About</button>
      </div>
      <div class="row subheader">
        <span class="title">
          <code>{{ this.url }}</code>
          &nbsp;
          <span class="counts"
            >( {{ loadedNumRows }} /
            <template v-if="totalNumRows >= 0">{{ totalNumRows }}</template>
            <template v-else>?</template>
            rows
            <button v-if="!loading && !isComplete" @click="loadMore">Load more...</button>
            )</span
          >
        </span>
        <button v-if="metadata" @click="showMetadata">Parquet Metadata</button>
        <button v-if="geoMetadata" @click="showGeoMetadata">GeoParquet Metadata</button>
      </div>
    </header>
    <main id="main">
      <section v-if="data.length === 0" id="error-container">
        <p v-if="loading">Data is loading...</p>
        <p v-else>No data available!</p>
      </section>
      <section v-else id="table-container">
        <table id="table">
          <thead>
            <tr>
              <th v-for="column of shownColumns" :key="column">{{ column }}</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="i of rowIndices"
              :key="i"
              @click="selectOnMap(i)"
              :id="`row_${i}`"
              :class="{ highlight: i === selected }"
            >
              <td v-for="column of shownColumns" :key="`cell_${column}_${i}`">
                <div>{{ data[column][i] }}</div>
              </td>
            </tr>
          </tbody>
        </table>
        <div v-if="!loading && !isComplete" class="loadmore">
          <button @click="loadMore">Load more...</button>&nbsp;
          <button @click="loadAll">Load all...</button>
        </div>
      </section>
      <section id="map-container"><div id="map"></div></section>
    </main>
    <template v-for="modal in modals" :key="modal.id">
      <component
        :is="modal.component"
        v-bind="modal.props"
        v-on="modal.events"
        @close="hideModal(modal)"
      />
    </template>
    <span v-if="loading" id="loading"><LoadingSpinner /></span>
  </div>
</template>

<script>
import { parquetRead, parquetMetadataAsync, parquetSchema, toJson } from 'hyparquet';
import { compressors as hycompressors } from 'hyparquet-compressors';
import { snappyUncompressor } from 'hysnappy';

import WKB from 'ol/format/WKB.js';
import Map from 'ol/Map.js';
import View from 'ol/View.js';
import Select from 'ol/interaction/Select.js';
import { OSM, Vector as VectorSource } from 'ol/source.js';
import { Tile as TileLayer, Vector as VectorLayer } from 'ol/layer.js';
import proj4 from 'proj4';
import { register } from 'ol/proj/proj4.js';
import { getStyle } from './map.js';

import Utils from './utils.js';

import LoadingSpinner from './components/LoadingSpinner.vue';

import AboutModal from './components/modals/AboutModal.vue';
import LoadDataModal from './components/modals/LoadDataModal.vue';
import MetadataModal from './components/modals/MetadataModal.vue';

const compressors = {
  ...hycompressors,
  snappy: snappyUncompressor()
};

// Todo: Ugly hack to change the default rendering of Date objects
Date.prototype.toString = Date.prototype.toISOString;

function getDefaults() {
  return {
    data: {},
    columns: [],
    offset: 0,
    pageSize: 100,
    fileSize: null,
    metadata: null,
    loading: false,
    selected: null,
    modals: []
  };
}

function getDefaultUrl() {
  const urlParams = new URLSearchParams(window.location.search);
  const url = urlParams.get('url');
  if (url) {
    return url;
  } else {
    return null;
  }
}

export default {
  name: 'App',
  components: {
    AboutModal,
    LoadDataModal,
    MetadataModal,
    LoadingSpinner
  },
  data() {
    return Object.assign(
      {
        source: new VectorSource(),
        map: null,
        url: null,
        defaultStyle: getStyle(),
        selectStyle: getStyle('#FF0000')
      },
      getDefaults()
    );
  },
  computed: {
    asyncBuffer() {
      return {
        byteLength: this.fileSize,
        slice: async (start, end) => {
          const rangeEnd = end === undefined ? '' : end - 1;
          const res = await fetch(this.url, {
            headers: {
              Range: `bytes=${start}-${rangeEnd}`
            }
          });
          return res.arrayBuffer();
        }
      };
    },
    loadedNumRows() {
      const keys = Object.keys(this.data);
      if (keys.length > 0 && Array.isArray(this.data[keys[0]])) {
        return this.data[keys[0]].length;
      }
      return 0;
    },
    rowIndices() {
      return Array.from({ length: this.loadedNumRows }, (_, i) => i);
    },
    totalNumRows() {
      return this.metadata?.num_rows;
    },
    isComplete() {
      return this.loadedNumRows >= 0 && this.loadedNumRows >= this.totalNumRows;
    },
    geoMetadata() {
      const geo = this.metadata?.key_value_metadata?.find((md) => md.key === 'geo');
      if (geo && geo.value) {
        return JSON.parse(geo.value);
      }
      return null;
    },
    primaryGeoColumn() {
      if (this.geoMetadata) {
        return this.geoMetadata.columns[this.geoMetadata.primary_column];
      }
      return {};
    },
    schema() {
      if (this.metadata) {
        return parquetSchema(this.metadata);
      }
      return null;
    },
    columnsInSchema() {
      if (this.schema) {
        return this.schema.children.map((child) => child.element.name);
      }
      return [];
    },
    shownColumns() {
      return this.columns.filter((column) => !(column in this.geoMetadata.columns));
    },
    crs() {
      const crs = this.primaryGeoColumn.crs;
      if (crs && crs.id) {
        return `${crs.id.authority}:${crs.id.code}`;
      }
      return 'EPSG:4326';
    }
  },
  watch: {
    url() {
      history.pushState({}, '', `?url=${this.url}`);
      this.load();
    }
  },
  mounted() {
    this.url = getDefaultUrl();
    this.createMap();
    if (this.url) {
      this.load();
    }
    else {
      this.showLoad();
    }
  },
  methods: {
    showModal(component, props = {}, events = {}, id = null) {
      this.modals.push({
        component,
        props,
        events,
        id: id || 'modal_' + Date.now()
      });
    },
    hideModal(modal) {
      let id = Utils.isObject(modal) ? modal.id : modal;
      let index = this.modals.findIndex((other) => other.id === id);
      if (typeof index !== 'undefined') {
        this.modals.splice(index, 1);
      }
    },
    showAbout() {
      this.showModal('AboutModal');
    },
    showLoad() {
      this.showModal(
        'LoadDataModal',
        { url: this.url },
        {
          save: (url) => {
            this.url = url;
          }
        }
      );
    },
    showGeoMetadata() {
      this.showModal('MetadataModal', { data: this.geoMetadata });
    },
    showMetadata() {
      this.showModal('MetadataModal', { data: toJson(this.metadata) });
    },
    unselectFeature() {
      if (this.selected === null) {
        return;
      }
      this.setFeatureStyle(this.selected, this.defaultStyle);
    },
    selectFeature() {
      if (this.selected === null) {
        return;
      }
      const feature = this.setFeatureStyle(this.selected, this.selectStyle);
      const geometry = feature.getGeometry();
      const type = geometry.getType();
      let fitOpts;
      if (type === 'Point') {
        fitOpts = { minResolution: 1000 };
      } else {
        fitOpts = { padding: [100, 100, 100, 100] };
      }
      this.map.getView().fit(geometry.getExtent(), fitOpts);
    },
    setFeatureStyle(id, style) {
      const feature = this.source.getFeatureById(id);
      if (!feature) {
        return;
      }
      feature.setStyle(style);
      return feature;
    },
    select(i) {
      this.unselectFeature();
      this.selected = i;
    },
    selectOnMap(i) {
      this.select(i);
      this.selectFeature('#FF0000');
    },
    selectInTable(i) {
      this.select(i);
      document.getElementById(`row_${i}`).scrollIntoView({ block: 'center' });
    },
    reset() {
      const defaults = getDefaults();
      for (const key in defaults) {
        this[key] = defaults[key];
      }
      this.source.clear();
    },
    async discover() {
      try {
        const head = await fetch(this.url, { method: 'HEAD' });
        if (!head.ok) {
          throw new Error(`Error (${head.status}) fetching file: ${head.statusText}`);
        }
        const size = head.headers.get('content-length');
        if (!size) {
          throw new Error('No content-length header returned by server');
        }
        this.fileSize = Number(size);
        this.metadata = await parquetMetadataAsync(this.asyncBuffer);
        if (this.columns.length === 0) {
          this.columns = this.columnsInSchema;
        }
      } catch (error) {
        this.showError(error.message);
      }
    },
    async load() {
      this.reset();
      await this.loadMore();
    },
    async loadAll() {
      this.pageSize = 0;
      await this.loadMore();
    },
    async loadMore() {
      if (this.isComplete) {
        return;
      }
      this.loading = true;
      try {
        if (this.fileSize === null) {
          await this.discover();
        }
        const rowStart = this.offset;
        let rowEnd = undefined;
        if (this.pageSize) {
          rowEnd = this.offset + this.pageSize;
        }
        this.columnsInSchema.forEach((column) => {
          if (!Array.isArray(this.data[column])) {
            this.data[column] = [];
          }
        });
        await parquetRead({
          file: this.asyncBuffer,
          metadata: this.metadata,
          compressors,
          columns: this.columns.length === 0 ? undefined : this.columns,
          rowStart,
          rowEnd,
          utf8: false, // Don't convert binary data as UTF-8, otherwise we can't read the WKB properly
          onChunk: ({ columnName, columnData }) => {
            if (this.pageSize) {
              columnData = columnData.slice(0, this.pageSize);
            }
            // todo: check what is faster:
            columnData.forEach((x) => this.data[columnName].push(x));
            // this.data[columnName] = this.data[columnName].concat(data);
          }
        });
        this.offset += this.pageSize;
        await this.parseWKB();
        await this.addToMap();
        this.selectFeature();
      } catch (error) {
        this.showError(error.message);
      } finally {
        this.loading = false;
      }
    },
    async loadProj(code) {
      if (proj4.defs(code)) {
        return;
      }
      try {
        const path = code.toLowerCase().replace(':', '/');
        const response = await fetch(`https://spatialreference.org/ref/${path}/ogcwkt/`);
        const wkt = await response.text();
        proj4.defs(code, wkt);
        register(proj4);
        return proj4.defs(code);
      } catch (error) {
        this.showError(`Failed to load projection ${code}: ${error.message}`);
      }
    },
    async parseWKB() {
      const format = new WKB();
      await this.loadProj(this.crs);
      const featureOpts = {
        dataProjection: this.crs,
        featureProjection: 'EPSG:3857'
      };
      for (const column in this.geoMetadata.columns) {
        for (const i in this.data[column]) {
          const feature = format.readFeature(this.data[column][i], featureOpts);
          feature.setId(i);
          this.data[column][i] = feature;
        }
      }
    },
    async addToMap() {
      for (const feature of this.data[this.geoMetadata.primary_column]) {
        this.source.addFeature(feature);
      }
      this.map.getView().fit(this.source.getExtent());
    },
    showError(message) {
      alert(message);
    },
    createMap() {
      const select = new Select({ style: this.selectStyle });
      select.on('select', (e) => this.selectInTable(parseInt(e.selected[0].getId(), 10)));
      this.map = new Map({
        layers: [
          new TileLayer({
            source: new OSM()
          }),
          new VectorLayer({
            source: this.source
          })
        ],
        target: 'map',
        view: new View({
          center: [0, 0],
          zoom: 2
        })
      });
      this.map.addInteraction(select);
    }
  }
};
</script>

<style lang="scss">
@import url('../node_modules/ol/ol.css');

html,
body,
#app,
#viewer {
  height: 100%;
  margin: 0;
  padding: 0;
  font-family: sans-serif;
}

#header {
  height: 4rem;
  background-color: #333;
  color: #fff;

  .row {
    height: 2rem;
    display: flex;
    align-items: center;
    gap: 1rem;
    padding: 0 0.5rem;
    box-sizing: border-box;

    .title {
      margin: 0;
      padding: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      flex-grow: 1;
    }
    button {
      white-space: nowrap;
    }
    h1 {
      font-size: 1.2rem;
    }
  }

  .subheader {
    background-color: #777;
  }
}

#main {
  height: calc(100% - 4rem);
}
#map-container,
#table-container,
#error-container {
  width: 100%;
  height: 50%;
}
#table-container {
  overflow: auto;
}
#error-container {
  display: flex;
  align-items: center;
  justify-content: center;
}
#table {
  width: 100%;
  border-collapse: separate;
  border-spacing: 0;

  thead {
    position: sticky;
    top: 0;
    box-shadow: 0 2px 2px -1px rgba(0, 0, 0, 0.4);
  }

  tr {
    &:nth-child(odd) {
      background-color: #f2f2f2;
    }
    &.highlight {
      background-color: #ff9999 !important;
    }
  }

  td,
  th {
    border-width: 0 1px 1px 0;
    border-color: #555;
    border-style: solid;
    font-size: 0.8rem;
    max-width: 10rem;
  }

  th {
    background-color: #ccc;
    padding: 0.3rem;
  }

  td > div {
    padding: 0.3rem;
    box-sizing: border-box;
    width: 100%;
    height: 100%;
    max-width: 100%;
    max-height: 3rem;
    overflow: auto;
    word-wrap: break-word;
  }
}
form {
  .row {
    display: flex;
    margin: 0.25em 0;
  }
  label {
    width: 30%;
    display: flex;
    align-items: center;
  }
  .input {
    flex-grow: 1;
    display: flex;
  }
  .input input {
    flex-grow: 1;
  }
  input {
    padding: 0.3em;
  }
  input,
  button {
    margin: 3px;
  }
}
#map {
  width: 100%;
  height: 100%;
}
.loadmore {
  text-align: center;
  padding: 0.5rem;
}
#loading {
  position: absolute;
  bottom: 1rem;
  left: 1rem;
  width: 5rem;
  height: 5rem;
}
</style>
