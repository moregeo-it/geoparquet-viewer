<template>
  <div class="loading-overlay">
    <div class="loading-content">
      <v-progress-circular indeterminate color="primary" size="48" width="4" />
      <p v-if="message" class="text-body-2 text-grey-darken-1 mt-4">{{ message }}</p>
    </div>
  </div>
</template>

<script>
export default {
  name: 'LoadingOverlay',
  props: {
    message: { type: String, default: '' }
  }
};
</script>

<style scoped>
.loading-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(255, 255, 255, 0.85);
  z-index: 10;
}
.loading-content {
  text-align: center;
}
</style>
