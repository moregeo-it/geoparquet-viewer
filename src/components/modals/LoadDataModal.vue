<template>
  <v-dialog
    :model-value="modelValue"
    @update:model-value="$emit('update:modelValue', $event)"
    max-width="600"
  >
    <v-card>
      <v-card-title>Load Data</v-card-title>
      <v-card-text>
        <h3 class="text-subtitle-1 font-weight-bold mb-2">From URL</h3>
        <v-text-field
          v-model="newUrl"
          label="URL"
          placeholder="https://example.com/data.parquet"
          density="compact"
          variant="outlined"
          hide-details
          @keydown.enter="submit"
        />

        <h3 class="text-subtitle-1 font-weight-bold mt-4 mb-2">From local file</h3>
        <v-file-input
          label="File"
          accept=".parquet,.geoparquet"
          density="compact"
          variant="outlined"
          hide-details
          prepend-icon=""
          prepend-inner-icon="mdi-file"
          @update:model-value="onFileSelect"
        />

        <v-divider class="my-4" />

        <h3 class="text-subtitle-1 font-weight-bold mb-2">Examples</h3>
        <v-list density="compact" class="pa-0">
          <v-list-item
            v-for="example in exampleList"
            :key="example.url"
            :title="example.title"
            prepend-icon="mdi-file-document-outline"
            @click="selectExample(example.url)"
          />
        </v-list>
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn @click="$emit('update:modelValue', false)">Cancel</v-btn>
        <v-btn color="primary" variant="flat" @click="submit">Load</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script>
export default {
  name: 'LoadDataModal',
  props: {
    modelValue: { type: Boolean, default: false },
    url: { type: String, default: '' }
  },
  emits: ['update:modelValue', 'save', 'loadFile'],
  data() {
    return {
      newUrl: '',
      selectedFile: null,
      exampleList: [
        {
          url: 'https://raw.githubusercontent.com/visgl/loaders.gl/master/modules/parquet/test/data/geoparquet/airports.parquet',
          title: 'Airports (small, points)'
        },
        {
          url: 'https://data.source.coop/addresscloud/epc/geoparquet-local-authority/Wolverhampton.parquet',
          title: 'Energy performance certificates Wolverhampton (medium, polygons)'
        },
        {
          url: 'https://data.source.coop/fiboa/ai4sf/ai4sf.parquet',
          title: 'Field boundaries Cambodia/Vietnam (medium, polygons)'
        },
        {
          url: 'https://data.source.coop/fiboa/de-bb/dfbk.parquet',
          title: 'Building footprints Berlin / Brandenburg (large, polygons)'
        }
      ]
    };
  },
  watch: {
    modelValue(open) {
      if (open) {
        this.newUrl = this.url || '';
        this.selectedFile = null;
      }
    }
  },
  methods: {
    selectExample(url) {
      this.newUrl = url;
      this.selectedFile = null;
    },
    onFileSelect(files) {
      const file = Array.isArray(files) ? files[0] : files;
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
      this.$emit('update:modelValue', false);
    }
  }
};
</script>
