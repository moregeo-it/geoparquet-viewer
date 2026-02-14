import { createApp } from 'vue';
import { createVuetify } from 'vuetify';
import 'vuetify/styles';
import '@mdi/font/css/materialdesignicons.css';
import 'maplibre-gl/dist/maplibre-gl.css';
import App from './App.vue';

const vuetify = createVuetify();

createApp(App).use(vuetify).mount('#app');
