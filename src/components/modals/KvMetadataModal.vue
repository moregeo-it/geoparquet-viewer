<template>
  <v-dialog
    :model-value="modelValue"
    @update:model-value="$emit('update:modelValue', $event)"
    max-width="750"
    scrollable
  >
    <v-card>
      <v-card-title class="d-flex align-center">
        Metadata
        <v-spacer />
        <v-btn icon size="small" variant="text" @click="$emit('update:modelValue', false)">
          <v-icon>mdi-close</v-icon>
        </v-btn>
      </v-card-title>
      <v-divider />
      <v-card-text v-if="entries.length === 0" class="text-center text-grey pa-6">
        No key-value metadata found.
      </v-card-text>
      <v-card-text v-else class="pa-0">
        <v-expansion-panels variant="accordion">
          <v-expansion-panel v-for="entry in entries" :key="entry.key">
            <v-expansion-panel-title>
              <strong>{{ entry.label }}</strong>
              <v-chip v-if="entry.key === 'geo'" size="x-small" color="success" class="ml-2">
                GeoParquet
              </v-chip>
            </v-expansion-panel-title>
            <v-expansion-panel-text>
              <vue-json-pretty
                v-if="entry.isJson"
                :data="entry.parsed"
                :deep="1"
                :show-icon="true"
                :show-line="false"
              />
              <div v-else>{{ entry.value }}</div>
            </v-expansion-panel-text>
          </v-expansion-panel>
        </v-expansion-panels>
      </v-card-text>
    </v-card>
  </v-dialog>
</template>

<script>
import VueJsonPretty from 'vue-json-pretty';
import 'vue-json-pretty/lib/styles.css';

const FRIENDLY_NAMES = {
  geo: 'GeoParquet',
  'ARROW:schema': 'Arrow Schema',
  pandas: 'Pandas',
  'org.apache.spark.sql.parquet.row.metadata': 'Spark Row Metadata'
};

export default {
  name: 'KvMetadataModal',
  components: { VueJsonPretty },
  props: {
    modelValue: { type: Boolean, default: false },
    kvMetadata: { type: Object, default: null }
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
    }
  }
};
</script>
