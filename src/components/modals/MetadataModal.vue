<template>
  <v-dialog
    :model-value="modelValue"
    @update:model-value="$emit('update:modelValue', $event)"
    max-width="900"
    scrollable
  >
    <v-card>
      <v-card-title>{{ title }}</v-card-title>
      <v-card-text>
        <pre
          v-if="typeof formattedData === 'string'"
          class="text-body-2"
          style="white-space: pre-wrap; word-break: break-word"
          >{{ formattedData }}</pre
        >
        <v-data-table
          v-else-if="Array.isArray(formattedData)"
          :headers="tableHeaders"
          :items="formattedItems"
          density="compact"
          class="text-caption"
          items-per-page="-1"
        >
          <template #bottom />
        </v-data-table>
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn @click="$emit('update:modelValue', false)">Close</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script>
export default {
  name: 'MetadataModal',
  props: {
    modelValue: { type: Boolean, default: false },
    title: { type: String, default: 'Metadata' },
    data: { type: [Object, Array, String], default: null }
  },
  emits: ['update:modelValue'],
  computed: {
    formattedData() {
      if (!this.data) return '';
      if (typeof this.data === 'string') return this.data;
      if (Array.isArray(this.data)) return this.data;
      return JSON.stringify(this.data, this.replacer, 2);
    },
    tableHeaders() {
      if (Array.isArray(this.formattedData) && this.formattedData.length > 0) {
        return Object.keys(this.formattedData[0]).map((key) => ({
          title: key,
          key,
          sortable: false
        }));
      }
      return [];
    },
    formattedItems() {
      if (!Array.isArray(this.formattedData)) return [];
      return this.formattedData.map((row) => {
        const formatted = {};
        for (const [key, val] of Object.entries(row)) {
          if (val === null || val === undefined) formatted[key] = '';
          else if (typeof val === 'bigint') formatted[key] = Number(val).toLocaleString();
          else if (typeof val === 'object') formatted[key] = JSON.stringify(val);
          else formatted[key] = val;
        }
        return formatted;
      });
    }
  },
  methods: {
    replacer(key, value) {
      if (typeof value === 'bigint') return Number(value);
      return value;
    }
  }
};
</script>
