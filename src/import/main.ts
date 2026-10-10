import { createApp } from 'vue';
import ImportApp from './ImportApp.vue';
import { bootstrapTheme } from '../popup/composables/useTheme';

void bootstrapTheme().then(() => {
  createApp(ImportApp).mount('#app');
});
