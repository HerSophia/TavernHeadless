import { createTavernClient } from "@tavern/sdk";

export const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3000";

/** 共享的 TavernHeadless 客户端单例（聊天 / 会话 / 楼层 / trace 等）。 */
export const apiClient = createTavernClient({
  baseUrl: apiBaseUrl,
  // 调用时解析全局 fetch（而非创建客户端时捕获引用）：prod 行为不变，
  // 同时让 msw 等测试拦截器（晚于本模块加载才打补丁）也能生效。
  fetchImpl: (input, init) => globalThis.fetch(input, init)
});
