import { createPinia } from "pinia";
import { createApp } from "vue";

import App from "./App.vue";
import { i18n } from "./app/i18n";
import { router } from "./app/router";
import { useBackendConnectionStore } from "./stores/backend-connection";
import "./style.css";

const app = createApp(App);
const pinia = createPinia();

app.use(pinia).use(router).use(i18n);

// 预初始化后端连接：把持久化/默认连接写入运行时 active，确保首屏请求即指向正确后端与鉴权。
useBackendConnectionStore(pinia);

app.mount("#app");
