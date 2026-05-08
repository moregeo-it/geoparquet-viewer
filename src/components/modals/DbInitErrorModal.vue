<!-- DbInitErrorModal.vue -->
<template>
  <v-dialog :model-value="modelValue" persistent max-width="480">
    <v-card>
      <v-card-title class="d-flex align-center ga-2">
        <v-icon color="error">mdi-alert-circle</v-icon>
        Failed to start DuckDB
      </v-card-title>
      <v-card-text>
        <p>
          DuckDB failed to initialise. The application cannot function without DuckDB. Please reload
          to try again.
        </p>
        <p v-if="error?.message" class="mt-2 text-body-small text-medium-emphasis">
          Error details: {{ error.message }}
        </p>
      </v-card-text>
      <v-card-actions class="justify-end">
        <v-btn color="primary" variant="flat" @click="reload"> Reload page </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script>
export default {
  name: 'DbInitErrorModal',
  props: {
    modelValue: { type: Boolean, default: false },
    error: { type: Error, default: null }
  },
  emits: ['update:modelValue', 'proceed'],
  methods: {
    reload() {
      window.location.reload();
    }
  }
};
</script>
