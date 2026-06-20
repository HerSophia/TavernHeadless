import { createPinia } from "pinia";
import { createApp } from "vue";

import App from "./App.vue";
import { i18n } from "./app/i18n";
import { router } from "./app/router";
import "./style.css";

createApp(App).use(createPinia()).use(router).use(i18n).mount("#app");
