import { createTavernClient } from "@tavern/sdk";

import { getActiveAuthHeaders, getActiveBaseUrl } from "./backend/active";

type TavernClient = ReturnType<typeof createTavernClient>;

let cachedBaseUrl: string | null = null;
let cachedClient: TavernClient | null = null;

/**
 * 按当前后端连接构建/复用 SDK 客户端：
 * - baseUrl 变化才重建客户端（`createTavernClient` 在创建时捕获 baseUrl）；
 * - 鉴权头经 `getHeaders` 回调每次动态读取，切换凭证无需重建；
 * - fetch 在调用时解析全局 fetch（prod 行为不变，且利于 msw 等测试拦截器生效）。
 */
export function getApiClient(): TavernClient {
  const baseUrl = getActiveBaseUrl();
  if (!cachedClient || cachedBaseUrl !== baseUrl) {
    cachedBaseUrl = baseUrl;
    cachedClient = createTavernClient({
      baseUrl,
      fetchImpl: (input, init) => globalThis.fetch(input, init),
      getHeaders: () => getActiveAuthHeaders(),
    });
  }
  return cachedClient;
}

/**
 * 兼容既有调用点（context / chat 等）的客户端代理：每次属性访问转发到当前连接对应的客户端。
 * 切换后端连接后，后续调用自动改向新 baseUrl 与鉴权头，无需各调用点改动。
 */
export const apiClient = new Proxy({} as TavernClient, {
  get(_target, property) {
    return Reflect.get(getApiClient() as object, property);
  },
});

/** 当前后端连接的 baseUrl（运行时随连接变化）。 */
export function getApiBaseUrl(): string {
  return getActiveBaseUrl();
}
