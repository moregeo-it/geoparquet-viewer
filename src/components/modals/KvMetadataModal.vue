<template>
  <v-dialog
    :model-value="modelValue"
    @update:model-value="$emit('update:modelValue', $event)"
    max-width="35%"
    max-height="80%"
    scrollable
  >
    <v-card>
      <v-card-title class="d-flex align-center">
        {{ dialogTitle }}
        <v-spacer />
        <v-btn icon size="small" variant="text" @click="$emit('update:modelValue', false)">
          <v-icon>mdi-close</v-icon>
        </v-btn>
      </v-card-title>
      <v-divider />
      <v-card-text v-if="displayEntries.length === 0" class="text-center text-grey pa-6">
        No key-value metadata found.
      </v-card-text>
      <v-card-text v-else>
        <template v-for="entry in displayEntries" :key="entry.key">
          <vue-json-pretty
            v-if="entry.isJson"
            :data="entry.parsed"
            :deep="1"
            :show-icon="true"
            :show-line="false"
          />
          <div
            v-else
            style="
              white-space: pre-wrap;
              word-break: break-word;
              font-family: monospace;
              font-size: 0.8rem;
            "
          >
            {{ entry.value }}
          </div>
        </template>
      </v-card-text>
    </v-card>
  </v-dialog>
</template>

<script>
import VueJsonPretty from 'vue-json-pretty';
import 'vue-json-pretty/lib/styles.css';

export const FRIENDLY_NAMES = {
  geo: 'GeoParquet',
  'ARROW:schema': 'Arrow Schema',
  pandas: 'Pandas',
  fiboa: 'fiboa',
  'org.apache.spark.sql.parquet.row.metadata': 'Spark Row Metadata'
};

export default {
  name: 'KvMetadataModal',
  components: { VueJsonPretty },
  props: {
    modelValue: { type: Boolean, default: false },
    kvMetadata: { type: Object, default: null },
    initialKey: { type: String, default: null }
  },
  emits: ['update:modelValue'],
  computed: {
    entries() {
      if (!this.kvMetadata) return [];
      const keys = Object.keys(this.kvMetadata);
      keys.sort((a, b) => {
        if (a === 'geo') return -1;
        if (b === 'geo') return 1;
        return a.localeCompare(b);
      });

      return keys.map((key) => {
        let value = this.kvMetadata[key];
        const label = FRIENDLY_NAMES[key] || key;
        let isJson = false;
        let parsed = null;

        if (key === 'ARROW:schema' && typeof value === 'string') {
          try {
            const decoded = atob(value);
            value = decoded;
          } catch {
            /* keep original */
          }
        }

        if (typeof value === 'object' && value !== null) {
          isJson = true;
          parsed = value;
        } else if (typeof value === 'string') {
          try {
            const p = JSON.parse(value);
            if (typeof p === 'object' && p !== null) {
              isJson = true;
              parsed = p;
            }
          } catch {
            /* not JSON */
          }
        }

        return { key, label, value: String(value), isJson, parsed };
      });
    },
    displayEntries() {
      if (this.initialKey) {
        return this.entries.filter((e) => e.key === this.initialKey);
      }
      return this.entries;
    },
    dialogTitle() {
      if (this.initialKey && this.displayEntries.length === 1) {
        return this.displayEntries[0].label;
      }
      return 'Metadata';
    }
  }
};
</script>
