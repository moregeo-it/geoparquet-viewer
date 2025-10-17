<template>
  <BaseModal width="50%" title="Load Data" @submit="submit">
    <div class="row">
      <label for="url">URL:</label>
      <input class="input" id="url" v-model="newUrl" />
    </div>
  </BaseModal>
</template>

<script>
import BaseModal from './BaseModal.vue';

export default {
  name: 'LoadDataModal',
  components: {
    BaseModal
  },
  data() {
    return {
      newUrl: ''
    };
  },
  props: {
    url: {
      type: String,
      default: ''
    }
  },
  created() {
    this.newUrl = this.url;
  },
  methods: {
    submit() {
      this.$emit('save', this.newUrl);
      this.$emit('close');
    }
  }
};
</script>

<style></style>
