import { createRouter, createWebHistory, type RouteRecordRaw } from "vue-router";

const routes: RouteRecordRaw[] = [
  { path: "/", redirect: "/graph" },
  {
    path: "/graph",
    name: "graph",
    component: () => import("../modules/graph/GraphView.vue")
  },
  {
    path: "/chat",
    name: "chat",
    component: () => import("../modules/chat/ChatView.vue")
  }
];

export const router = createRouter({
  history: createWebHistory(),
  routes
});
