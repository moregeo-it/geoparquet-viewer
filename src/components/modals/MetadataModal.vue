<template>
  <BaseModal width="80%" title="Parquet Metadata">
    <pre>{{ formatted }}</pre>
  </BaseModal>
</template>

<script>
import BaseModal from './BaseModal.vue';

export default {
  name: 'AboutModal',
  components: {
    BaseModal
  },
  props: {
    data: {
      type: Object,
      required: true
    }
  },
  computed: {
    formatted() {
      return JSON.stringify(this.data, null, 2);
    }
  }
};
</script>
