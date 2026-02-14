<template>
  <div class="loading-bar" aria-label="Loading">
    <div class="loading-bar-track"></div>
  </div>
</template>

<script>
export default {
  name: 'LoadingSpinner'
};
</script>

<style scoped>
.loading-bar {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  height: 3px;
  z-index: 9999;
  overflow: hidden;
  background: rgba(0, 0, 0, 0.1);
}
.loading-bar-track {
  height: 100%;
  width: 40%;
  background: #1976d2;
  border-radius: 0 2px 2px 0;
  animation: loadSlide 1.2s ease-in-out infinite;
}
@keyframes loadSlide {
  0% {
    transform: translateX(-100%);
  }
  100% {
    transform: translateX(350%);
  }
}
</style>
