<template>
  <v-dialog
    :model-value="modelValue"
    @update:model-value="$emit('update:modelValue', $event)"
    width="auto"
  >
    <v-card>
      <v-card-title class="text-h6">Loading all remaining data?</v-card-title>
      <v-card-text class="text-body-2">
        There are <strong>{{ remainingRows.toLocaleString() }}</strong> rows left to load.<br />This
        may take a while or even fail and could use significant memory.
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn variant="text" @click="cancel">Cancel</v-btn>
        <v-btn color="primary" variant="flat" @click="confirmLoad()">Load All</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script>
export default {
  props: {
    modelValue: { type: Boolean, default: false },
    remainingRows: { type: Number, default: 0 }
  },
  emits: ['update:modelValue', 'load-all'],
  methods: {
    confirmLoad() {
      this.$emit('update:modelValue', false);
      this.$emit('load-all');
    },
    cancel() {
      this.$emit('update:modelValue', false);
    }
  }
};
</script>
