<template>
  <v-dialog
    :model-value="modelValue"
    @update:model-value="$emit('update:modelValue', $event)"
    max-width="1000px"
    persistent
  >
    <v-card>
      <v-card-title class="d-flex align-center ga-2">
        <v-icon color="warning" icon="mdi-alert-outline" />
        File Warnings
      </v-card-title>
      <v-divider />
      <v-card-text>
        <p class="text-body-2 mb-3">
          This file has characteristics that are not optimized for web viewing and may load slowly
          or not at all. The following warnings were detected:
        </p>
        <v-list density="compact" class="pa-0">
          <v-list-item
            v-for="(warning, i) in warnings"
            :key="i"
            :prepend-icon="warning.icon"
            class="px-0"
          >
            <v-list-item-title class="text-body-2 font-weight-medium">
              {{ warning.title }}
            </v-list-item-title>
            <v-list-item-subtitle class="text-caption">
              {{ warning.detail }}
            </v-list-item-subtitle>
          </v-list-item>
        </v-list>
        <p class="text-body-2 mt-4 text-grey-darken-1">
          You can still proceed — loading may take significant time depending on your connection
          speed.
        </p>
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn variant="text" @click="cancel">Cancel</v-btn>
        <v-btn color="warning" variant="flat" @click="proceed">Proceed anyway</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script>
export default {
  name: 'FileWarningModal',
  props: {
    modelValue: { type: Boolean, default: false },
    warnings: { type: Array, default: () => [] }
  },
  emits: ['update:modelValue', 'proceed', 'cancel'],
  methods: {
    proceed() {
      this.$emit('update:modelValue', false);
      this.$emit('proceed');
    },
    cancel() {
      this.$emit('update:modelValue', false);
      this.$emit('cancel');
    }
  }
};
</script>

<style scoped>
:deep(.v-list-item-subtitle) {
  -webkit-line-clamp: none;
  overflow: visible;
  text-overflow: initial;
  white-space: pre-wrap;
  line-height: 1.33em;
}
</style>
