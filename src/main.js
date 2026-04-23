import { createApp } from 'vue';
import { createVuetify } from 'vuetify';
import 'vuetify/styles';
import '@mdi/font/css/materialdesignicons.css';
import 'maplibre-gl/dist/maplibre-gl.css';
import { SNotify } from '@theace0296/vue-snotify';
import '@theace0296/vue-snotify/dist/styles/material.css';
import App from './App.vue';

const vuetify = createVuetify();

createApp(App)
  .use(vuetify)
  .use(SNotify, {
    toast: {
      position: 'rightBottom',
      showProgressBar: true,
      pauseOnHover: true,
      closeOnClick: true,
      titleMaxLength: 50,
      bodyMaxLength: 300,
      timeout: 5000
    }
  })
  .mount('#app');
