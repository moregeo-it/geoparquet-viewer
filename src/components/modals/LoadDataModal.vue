<template>
  <BaseModal width="50%" title="Load Data" @submit="submit">
    <h3>From URL</h3>
    <div class="form-row">
      <label for="load-url">URL:</label>
      <div class="input">
        <input id="load-url" v-model="newUrl" placeholder="https://example.com/data.parquet" />
      </div>
    </div>

    <h3>From local file</h3>
    <div class="form-row">
      <label for="load-file">File:</label>
      <div class="input">
        <input id="load-file" type="file" accept=".parquet,.geoparquet" @change="onFileSelect" />
      </div>
    </div>

    <hr />

    <h3>Examples</h3>
    <ul class="examples">
      <li v-for="(title, url) in examples" :key="url">
        <a :href="url" @click.prevent="selectExample(url)">{{ title }}</a>
      </li>
    </ul>
  </BaseModal>
</template>

<script>
import BaseModal from './BaseModal.vue';

export default {
  name: 'LoadDataModal',
  components: {
    BaseModal
  },
  props: {
    url: {
      type: String,
      default: ''
    }
  },
  emits: ['save', 'loadFile', 'close'],
  data() {
    return {
      newUrl: '',
      selectedFile: null,
      examples: {
        'https://raw.githubusercontent.com/visgl/loaders.gl/master/modules/parquet/test/data/geoparquet/airports.parquet':
          'Airports (small, points)',
        'https://data.source.coop/fiboa/ai4sf/ai4sf.parquet':
          'Field boundaries Cambodia/Vietnam (medium, polygons)'
      }
    };
  },
  created() {
    this.newUrl = this.url || '';
  },
  methods: {
    selectExample(url) {
      this.newUrl = url;
      this.selectedFile = null;
    },
    onFileSelect(event) {
      const file = event.target.files[0];
      if (file) {
        this.selectedFile = file;
        this.newUrl = '';
      }
    },
    submit() {
      if (this.selectedFile) {
        this.$emit('loadFile', this.selectedFile);
      } else if (this.newUrl) {
        this.$emit('save', this.newUrl);
      }
      this.$emit('close');
    }
  }
};
</script>

<style scoped>
h3 {
  margin: 0.8em 0 0.4em;
  font-size: 1rem;
}
h3:first-child {
  margin-top: 0;
}
.form-row {
  display: flex;
  margin: 0.25em 0;
}
.form-row label {
  width: 4rem;
  display: flex;
  align-items: center;
  font-size: 0.9rem;
}
.form-row .input {
  flex: 1;
}
.form-row .input input {
  width: 100%;
  padding: 0.4em;
  box-sizing: border-box;
}
.examples {
  margin: 0.3em 0;
  padding-left: 1.5em;
}
.examples li {
  margin-bottom: 0.3em;
}
hr {
  border: none;
  border-top: 1px solid #ddd;
  margin: 1em 0;
}
</style>
