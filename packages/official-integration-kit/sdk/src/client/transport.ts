import { createApiClient, type ApiClient, type ApiRequestResult } from "@tavern/shared";

import { createResponseError } from "../errors/normalize-error.js";

export type TavernClientOptions = {
  baseUrl: string;
  fetchImpl?: typeof fetch;
  getHeaders?: () => Record<string, string> | undefined | Promise<Record<string, string> | undefined>;
};

export type TransportRequestOptions = {
  accept?: string;
  body?: unknown;
  headers?: Record<string, string>;
  method?: string;
  signal?: AbortSignal;
};

export type TransportJsonResult<T> = {
  body: T | null;
  headers: Headers;
  raw: Response;
  status: number;
};

export type TransportClient = ApiClient & {
  baseUrl: string;
  fetchJson<T>(pathname: string, options?: TransportRequestOptions): Promise<TransportJsonResult<T>>;
  fetchRaw(pathname: string, options?: TransportRequestOptions): Promise<Response>;
};

/**
 * 兼容用途的账号提示值。
 *
 * 这个值只会用于构造旧的 `x-account-id` 请求头。
 * 它本身不会完成认证，也不会直接切换账号。
 * 多账号身份必须来自已绑定账号的 API Key 或 JWT 账号 claim。
 * 服务端授权以数据库中的账号记录为准。
 */
export type AccountIdHint = string;

/**
 * 构造旧的 `x-account-id` 兼容请求头。
 *
 * 这个头部不会单独完成认证，也不会直接切换账号。
 * 多账号身份必须来自已绑定账号的 API Key 或 JWT 账号 claim。
 * 服务端授权以数据库中的账号记录为准。
 */
export function buildAccountHeaders(accountId?: AccountIdHint): Record<string, string> | undefined {
  if (!accountId) {
    return undefined;
  }

  return {
    "x-account-id": accountId,
  };
}

export function createTransportClient(options: TavernClientOptions): TransportClient {
  const baseUrl = options.baseUrl.replace(/\/$/, "");
  const fetchImpl = options.fetchImpl ?? fetch;
  const apiClient = createApiClient({ baseUrl, fetchImpl });

  const request = (async (method: string, path: unknown, requestOptions?: Record<string, unknown>) => {
    const headers = await resolveHeaders(options, asHeaderRecord(requestOptions?.headers));

    return apiClient.request(method as never, path as never, {
      ...(requestOptions ?? {}),
      headers,
    } as never);
  }) as ApiClient["request"];

  return {
    baseUrl,
    delete: (async (path, requestOptions) => {
      const headers = await resolveHeaders(options, asHeaderRecord(requestOptions?.headers));

      return apiClient.delete(path as never, {
        ...(requestOptions ?? {}),
        headers,
      } as never);
    }) as ApiClient["delete"],
    fetchJson: async <T>(pathname: string, requestOptions: TransportRequestOptions = {}): Promise<TransportJsonResult<T>> => {
      const response = await fetchRaw(baseUrl, fetchImpl, options, pathname, requestOptions);
      if (!response.ok) {
        throw await createResponseError(response);
      }

      return {
        body: (await readJsonBody(response)) as T | null,
        headers: response.headers,
        raw: response,
        status: response.status,
      };
    },
    fetchRaw: (pathname, requestOptions) => fetchRaw(baseUrl, fetchImpl, options, pathname, requestOptions),
    get: (async (path, requestOptions) => {
      const headers = await resolveHeaders(options, asHeaderRecord(requestOptions?.headers));

      return apiClient.get(path as never, {
        ...(requestOptions ?? {}),
        headers,
      } as never);
    }) as ApiClient["get"],
    patch: (async (path, requestOptions) => {
      const headers = await resolveHeaders(options, asHeaderRecord(requestOptions?.headers));

      return apiClient.patch(path as never, {
        ...(requestOptions ?? {}),
        headers,
      } as never);
    }) as ApiClient["patch"],
    post: (async (path, requestOptions) => {
      const headers = await resolveHeaders(options, asHeaderRecord(requestOptions?.headers));

      return apiClient.post(path as never, {
        ...(requestOptions ?? {}),
        headers,
      } as never);
    }) as ApiClient["post"],
    put: (async (path, requestOptions) => {
      const headers = await resolveHeaders(options, asHeaderRecord(requestOptions?.headers));

      return apiClient.put(path as never, {
        ...(requestOptions ?? {}),
        headers,
      } as never);
    }) as ApiClient["put"],
    request,
  };
}

export function resolvePath(baseUrl: string, pathname: string): string {
  return `${baseUrl.replace(/\/$/, "")}${pathname}`;
}

async function fetchRaw(
  baseUrl: string,
  fetchImpl: typeof fetch,
  options: TavernClientOptions,
  pathname: string,
  requestOptions: TransportRequestOptions = {},
): Promise<Response> {
  const headers = new Headers(await resolveHeaders(options, requestOptions.headers));
  if (requestOptions.accept && !headers.has("accept")) {
    headers.set("accept", requestOptions.accept);
  }

  let body: BodyInit | undefined;
  if (requestOptions.body !== undefined) {
    body = JSON.stringify(requestOptions.body);
    if (!headers.has("content-type")) {
      headers.set("content-type", "application/json");
    }
  }

  return fetchImpl(resolvePath(baseUrl, pathname), {
    body,
    headers,
    method: requestOptions.method ?? (body === undefined ? "GET" : "POST"),
    signal: requestOptions.signal,
  });
}

async function resolveHeaders(
  options: TavernClientOptions,
  requestHeaders: Record<string, string> | undefined,
): Promise<Record<string, string> | undefined> {
  const headers = new Headers();
  const defaultHeaders = await options.getHeaders?.();

  appendHeaders(headers, defaultHeaders);
  appendHeaders(headers, requestHeaders);

  const resolved: Record<string, string> = {};
  headers.forEach((value, key) => {
    resolved[key] = value;
  });

  return Object.keys(resolved).length > 0 ? resolved : undefined;
}

function appendHeaders(target: Headers, source: Record<string, string> | undefined): void {
  if (!source) {
    return;
  }

  for (const [key, value] of Object.entries(source)) {
    target.set(key, value);
  }
}

function asHeaderRecord(value: unknown): Record<string, string> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }

  const record = Object.entries(value as Record<string, unknown>).filter((entry): entry is [string, string] => {
    return typeof entry[1] === "string";
  });

  return record.length > 0 ? Object.fromEntries(record) : undefined;
}

async function readJsonBody(response: Response): Promise<unknown> {
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    return null;
  }

  const text = await response.text();
  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
