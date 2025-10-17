<template>
  <BaseModal width="50%" title="Load Data" @submit="submit">
    <div class="row">
      <label for="url">URL:</label>
      <input class="input" id="url" v-model="newUrl" />
    </div>
    <hr />
    <div class="row">
      <label for="url">Examples:</label>
      <div class="input">
        <ul>
          <li v-for="(title, url) in examples" :key="url"><a :href="url" @click.prevent="select(url)">{{ title }}</a></li>
        </ul>
      </div>
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
      newUrl: '',
      examples: {
        'https://raw.githubusercontent.com/visgl/loaders.gl/master/modules/parquet/test/data/geoparquet/airports.parquet': 'Airports',
        'https://data.source.coop/fiboa/ai4sf/ai4sf.parquet': 'Field boundaries for Cambodia and Vietnam (AI4SmallFarms)',
      }
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
    select(url) {
      this.newUrl = url;
    },
    submit() {
      this.$emit('save', this.newUrl);
      this.$emit('close');
    }
  }
};
</script>

<style></style>
