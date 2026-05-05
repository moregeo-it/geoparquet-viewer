<template>
  <v-dialog
    :model-value="modelValue"
    @update:model-value="$emit('update:modelValue', $event)"
    width="auto"
    max-width="520"
    persistent
  >
    <v-card>
      <v-card-title class="d-flex align-center ga-2">
        <v-icon color="warning" icon="mdi-alert-outline" />
        Large File Warning
      </v-card-title>
      <v-divider />
      <v-card-text>
        <p class="text-body-2 mb-3">
          This file has characteristics that may cause slow loading or high memory usage in the
          browser:
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
          You can still proceed — metadata loading may take a while.
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
