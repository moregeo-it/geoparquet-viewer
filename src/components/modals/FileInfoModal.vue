<template>
  <v-dialog
    :model-value="modelValue"
    @update:model-value="$emit('update:modelValue', $event)"
    width="auto"
    scrollable
  >
    <v-card>
      <v-card-title class="d-flex align-center">
        File Info
        <v-spacer />
        <v-btn icon size="small" variant="text" @click="$emit('update:modelValue', false)">
          <v-icon>mdi-close</v-icon>
        </v-btn>
      </v-card-title>
      <v-divider />
      <v-card-text>
        <v-table density="compact">
          <tbody>
            <tr>
              <td class="font-weight-bold text-no-wrap">Source</td>
              <td>
                <span class="text-body-2 source-url">{{ source }}</span>
                <CopyButton
                  :copy-text="source"
                  size="small"
                  density="comfortable"
                  variant="text"
                  class="ml-1"
                />
              </td>
            </tr>
            <tr v-if="fileSize">
              <td class="font-weight-bold text-no-wrap">File Size</td>
              <td>{{ fileSize }}</td>
            </tr>
            <tr v-if="fileInfo?.format_version != null">
              <td class="font-weight-bold text-no-wrap">Parquet Version</td>
              <td>{{ fileInfo.format_version }}</td>
            </tr>
            <tr v-if="geoVersion">
              <td class="font-weight-bold text-no-wrap">GeoParquet Version</td>
              <td>{{ geoVersion }}</td>
            </tr>
            <tr v-if="fileInfo?.num_rows != null">
              <td class="font-weight-bold text-no-wrap">Rows</td>
              <td>{{ fileInfo.num_rows.toLocaleString() }}</td>
            </tr>
            <tr v-if="fileInfo?.num_row_groups != null">
              <td class="font-weight-bold text-no-wrap">Row Groups</td>
              <td>{{ fileInfo.num_row_groups.toLocaleString() }}</td>
            </tr>
            <tr v-if="rowGroupSize != null">
              <td class="font-weight-bold text-no-wrap">Row Group Size</td>
              <td>{{ rowGroupSize.toLocaleString() }}</td>
            </tr>
            <tr v-if="fileInfo?.created_by">
              <td class="font-weight-bold text-no-wrap">Created By</td>
              <td class="text-body-2">{{ fileInfo.created_by }}</td>
            </tr>
            <tr v-if="footerSize">
              <td class="font-weight-bold text-no-wrap">Footer Size</td>
              <td>{{ footerSize }}</td>
            </tr>
            <tr v-if="fileInfo?.encryption_algorithm">
              <td class="font-weight-bold text-no-wrap">Encryption</td>
              <td>{{ fileInfo.encryption_algorithm }}</td>
            </tr>
          </tbody>
        </v-table>
      </v-card-text>
    </v-card>
  </v-dialog>
</template>

<script>
import CopyButton from '../CopyButton.vue';

export default {
  name: 'FileInfoModal',
  components: { CopyButton },
  props: {
    modelValue: { type: Boolean, default: false },
    fileInfo: { type: Object, default: null },
    source: { type: String, default: '' },
    geoVersion: { type: String, default: null },
    rowGroupSize: { type: Number, default: null }
  },
  emits: ['update:modelValue'],
  computed: {
    fileSize() {
      const bytes = this.fileInfo?.file_size_bytes;
      if (!bytes) return null;
      return this.formatBytes(bytes);
    },
    footerSize() {
      const bytes = this.fileInfo?.footer_size;
      if (!bytes) return null;
      return this.formatBytes(bytes);
    }
  },
  methods: {
    formatBytes(bytes) {
      if (bytes < 1024) return `${bytes} B`;
      if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
      if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
      return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
    }
  }
};
</script>

<style scoped>
.source-url {
  word-break: break-all;
}
</style>
