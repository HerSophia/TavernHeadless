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
  },
  {
    path: "/workbench",
    name: "workbench",
    component: () => import("../modules/workbench/WorkbenchView.vue")
  },
  {
    path: "/library",
    name: "library",
    component: () => import("../modules/library/LibraryView.vue")
  },
  {
    path: "/settings",
    name: "settings",
    component: () => import("../modules/settings/SettingsView.vue")
  }
];

export const router = createRouter({
  history: createWebHistory(),
  routes
});
