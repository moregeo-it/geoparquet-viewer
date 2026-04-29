<template>
  <v-dialog
    :model-value="modelValue"
    @update:model-value="$emit('update:modelValue', $event)"
    max-width="28%"
  >
    <v-card>
      <v-card-title>Convert &amp; Download</v-card-title>
      <v-card-text>
        <p class="text-body-2 mb-3">
          Convert the currently loaded file to another format. The full file is converted in a
          background worker, which may take a while.
        </p>
        <v-radio-group v-model="format" hide-details density="compact">
          <v-radio
            v-for="f in availableFormats"
            :key="f.id"
            :value="f.id"
            :label="f.label"
            :disabled="f.requiresGeo && !hasGeometry"
          />
        </v-radio-group>
        <v-text-field
          v-model="outputName"
          label="Output filename (without extension)"
          density="compact"
          variant="outlined"
          hide-details
          class="mt-4"
        />
        <p v-if="!hasGeometry" class="text-caption text-grey mt-2">
          No geometry column detected — geo-aware formats are disabled.
        </p>
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn @click="$emit('update:modelValue', false)">Cancel</v-btn>
        <v-btn color="primary" variant="flat" :disabled="!format || !outputName" @click="submit">
          Convert
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script>
import { FORMATS } from '../../converter.js';

export default {
  name: 'ConvertModal',
  props: {
    modelValue: { type: Boolean, default: false },
    hasGeometry: { type: Boolean, default: false },
    defaultName: { type: String, default: 'export' }
  },
  emits: ['update:modelValue', 'convert'],
  data() {
    return {
      format: 'geojson',
      outputName: 'export',
      availableFormats: FORMATS
    };
  },
  watch: {
    modelValue(open) {
      if (open) {
        this.outputName = this.defaultName || 'export';
        if (!this.hasGeometry && this.format === 'geojson') {
          this.format = 'csv';
        }
      }
    }
  },
  methods: {
    submit() {
      this.$emit('convert', { format: this.format, outputName: this.outputName });
      this.$emit('update:modelValue', false);
    }
  }
};
</script>
