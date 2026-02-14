<template>
  <BaseModal width="80%" :title="title">
    <div class="metadata-content">
      <pre v-if="typeof formattedData === 'string'">{{ formattedData }}</pre>
      <table v-else-if="Array.isArray(formattedData)" class="metadata-table">
        <thead>
          <tr>
            <th v-for="key in tableKeys" :key="key">{{ key }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(row, i) in formattedData" :key="i">
            <td v-for="key in tableKeys" :key="key">
              <div class="meta-cell">{{ formatCell(row[key]) }}</div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </BaseModal>
</template>

<script>
import BaseModal from './BaseModal.vue';

export default {
  name: 'MetadataModal',
  components: {
    BaseModal
  },
  props: {
    title: {
      type: String,
      default: 'Metadata'
    },
    data: {
      type: [Object, Array, String],
      required: true
    }
  },
  computed: {
    formattedData() {
      if (typeof this.data === 'string') return this.data;
      if (Array.isArray(this.data)) return this.data;
      return JSON.stringify(this.data, this.replacer, 2);
    },
    tableKeys() {
      if (Array.isArray(this.formattedData) && this.formattedData.length > 0) {
        return Object.keys(this.formattedData[0]);
      }
      return [];
    }
  },
  methods: {
    replacer(key, value) {
      if (typeof value === 'bigint') return Number(value);
      return value;
    },
    formatCell(value) {
      if (value === null || value === undefined) return '';
      if (typeof value === 'bigint') return Number(value).toLocaleString();
      if (typeof value === 'object') return JSON.stringify(value);
      return String(value);
    }
  }
};
</script>

<style scoped>
.metadata-content {
  overflow: auto;
}
pre {
  white-space: pre-wrap;
  word-break: break-word;
  font-size: 0.85rem;
  margin: 0;
}
.metadata-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.8rem;
}
.metadata-table th {
  background: #e0e0e0;
  padding: 6px 8px;
  text-align: left;
  border-bottom: 2px solid #999;
  border-right: 1px solid #ccc;
  position: sticky;
  top: 0;
}
.metadata-table td {
  padding: 4px 8px;
  border-bottom: 1px solid #eee;
  border-right: 1px solid #f0f0f0;
}
.metadata-table tr:nth-child(even) {
  background: #fafafa;
}
.meta-cell {
  max-width: 300px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
