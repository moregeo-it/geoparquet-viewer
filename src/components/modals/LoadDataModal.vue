<template>
  <v-dialog
    :model-value="modelValue"
    @update:model-value="$emit('update:modelValue', $event)"
    width="auto"
    scrollable
  >
    <v-card>
      <v-card-title>Load Data</v-card-title>
      <v-divider />
      <v-card-text>
        <h3 class="text-subtitle-1 font-weight-bold mb-2">From URL</h3>
        <v-text-field
          v-model="newUrl"
          label="URL"
          placeholder="https://example.com/data.parquet"
          density="compact"
          variant="outlined"
          clearable
          hide-details="auto"
          :rules="[validateUrl]"
          hint="Supports public https://, http://, s3://, and gs:// URLs"
          persistent-hint
          @keydown.enter="(newUrl || selectedFile) && !urlValidationError && submit()"
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
        <v-btn
          color="primary"
          variant="flat"
          :disabled="(!newUrl && !selectedFile) || Boolean(urlValidationError)"
          @click="submit"
          >Load</v-btn
        >
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
        // tiny < 5 MB, small < 50 MB, medium < 200 MB, large < 1 GB, very large >= 1 GB
        {
          url: 'https://raw.githubusercontent.com/visgl/loaders.gl/master/modules/parquet/test/data/geoparquet/airports.parquet',
          title: 'Airports (< 1 MB, points)'
        },
        {
          url: 'https://data.source.coop/addresscloud/epc/geoparquet-local-authority/Wolverhampton.parquet',
          title: 'Energy performance certificates in Wolverhampton, UK (2 MB, points)'
        },
        {
          url: 'https://data.source.coop/fiboa/data/de_nrw/de_nrw.parquet',
          title: 'Field boundaries for North Rhine-Westphalia, Germany (254 MB, polygons)'
        },
        {
          url: 'https://data.source.coop/fiboa/japan/japan.parquet',
          title: 'Field boundaries for Japan (4.5 GB, polygons)'
        },
        {
          url: 'https://data.source.coop/fiboa/france-ec/france_eurocrops_2018_fiboa.parquet',
          title: 'EuroCrops 2018 for France (6 GB, polygons)'
        },
        {
          url: 'https://data.source.coop/vida/google-microsoft-osm-open-buildings/geoparquet/by_country/country_iso=IDN/IDN.parquet',
          title: 'Open buildings in Indonesia (16 GB, polygons)'
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
  computed: {
    urlValidationError() {
      if (!this.newUrl) return null;
      const result = this.validateUrl(this.newUrl);
      return result === true ? null : result;
    }
  },
  methods: {
    validateUrl(url) {
      if (!url) return true;

      const unsupportedProtocols = [
        { prefix: 'abfs://', name: 'Azure Data Lake Storage (abfs://)' },
        { prefix: 'abfss://', name: 'Azure Data Lake Storage (abfss://)' },
        { prefix: 'az://', name: 'Azure Blob Storage (az://)' },
        { prefix: 'wasb://', name: 'Azure Blob Storage (wasb://)' },
        { prefix: 'wasbs://', name: 'Azure Blob Storage (wasbs://)' },
        { prefix: 'hdfs://', name: 'HDFS (hdfs://)' }
      ];

      for (const { prefix, name } of unsupportedProtocols) {
        if (url.toLowerCase().startsWith(prefix)) {
          return `${name} is not supported. Please use a public https://, s3://, or gs:// URL instead.`;
        }
      }

      if (!/^https?:\/\//i.test(url) && !/^s3:\/\//i.test(url) && !/^gs:\/\//i.test(url)) {
        return 'URL must start with https://, http://, s3://, or gs://.';
      }

      return true;
    },
    selectExample(url) {
      this.newUrl = url;
      this.selectedFile = null;
      this.submit();
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
