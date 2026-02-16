import type { paths } from "../generated/openapi-types.js";

type HttpMethod = "get" | "post" | "put" | "patch" | "delete";
type ApiPath = keyof paths;

type OperationFor<Path extends ApiPath, Method extends HttpMethod> =
  Method extends keyof paths[Path] ? paths[Path][Method] : never;

type MethodForPath<Path extends ApiPath> = {
  [Method in HttpMethod]: OperationFor<Path, Method> extends never ? never : Method;
}[HttpMethod];

type PathsForMethod<Method extends HttpMethod> = {
  [Path in ApiPath]: Method extends MethodForPath<Path> ? Path : never;
}[ApiPath];

type OperationParameters<Op> = Op extends { parameters: infer Params } ? Params : never;
type OperationPathParams<Op> = OperationParameters<Op> extends { path?: infer Params } ? Params : never;
type OperationQueryParams<Op> = OperationParameters<Op> extends { query?: infer Params } ? Params : never;

type OperationRequestBody<Op> = Op extends { requestBody?: { content: { "application/json": infer Body } } }
  ? Body
  : Op extends { requestBody: { content: { "application/json": infer Body } } }
    ? Body
    : never;

type OperationJsonResponse<Op> = Op extends { responses: infer Responses }
  ? {
      [Status in keyof Responses]: Responses[Status] extends {
        content: { "application/json": infer Body };
      }
        ? Body
        : never;
    }[keyof Responses]
  : never;

export type ApiRequestOptions<Path extends ApiPath, Method extends HttpMethod> = {
  path?: OperationPathParams<OperationFor<Path, Method>>;
  query?: OperationQueryParams<OperationFor<Path, Method>>;
  body?: OperationRequestBody<OperationFor<Path, Method>>;
  headers?: Record<string, string>;
  signal?: AbortSignal;
};

export type ApiRequestResult<Path extends ApiPath, Method extends HttpMethod> = {
  body: OperationJsonResponse<OperationFor<Path, Method>> | null;
  headers: Headers;
  raw: Response;
  status: number;
};

export type CreateApiClientOptions = {
  baseUrl: string;
  fetchImpl?: typeof fetch;
};

export type ApiClient = {
  request<Path extends ApiPath, Method extends HttpMethod>(
    method: Method,
    path: Path,
    options?: ApiRequestOptions<Path, Method>
  ): Promise<ApiRequestResult<Path, Method>>;
  get<Path extends PathsForMethod<"get">>(
    path: Path,
    options?: ApiRequestOptions<Path, "get">
  ): Promise<ApiRequestResult<Path, "get">>;
  post<Path extends PathsForMethod<"post">>(
    path: Path,
    options?: ApiRequestOptions<Path, "post">
  ): Promise<ApiRequestResult<Path, "post">>;
  put<Path extends PathsForMethod<"put">>(
    path: Path,
    options?: ApiRequestOptions<Path, "put">
  ): Promise<ApiRequestResult<Path, "put">>;
  patch<Path extends PathsForMethod<"patch">>(
    path: Path,
    options?: ApiRequestOptions<Path, "patch">
  ): Promise<ApiRequestResult<Path, "patch">>;
  delete<Path extends PathsForMethod<"delete">>(
    path: Path,
    options?: ApiRequestOptions<Path, "delete">
  ): Promise<ApiRequestResult<Path, "delete">>;
};

type RuntimeRequestOptions = {
  path?: Record<string, unknown>;
  query?: Record<string, unknown>;
  body?: unknown;
  headers?: Record<string, string>;
  signal?: AbortSignal;
};

export function createApiClient(options: CreateApiClientOptions): ApiClient {
  const baseUrl = options.baseUrl.replace(/\/$/, "");
  const fetchImpl = options.fetchImpl ?? fetch;

  async function request<Path extends ApiPath, Method extends HttpMethod>(
    method: Method,
    path: Path,
    requestOptions?: ApiRequestOptions<Path, Method>
  ): Promise<ApiRequestResult<Path, Method>> {
    const runtimeOptions = requestOptions as RuntimeRequestOptions | undefined;
    const resolvedPath = applyPathParams(path as string, runtimeOptions?.path);
    const url = new URL(`${baseUrl}${resolvedPath}`);

    if (runtimeOptions?.query) {
      appendQuery(url.searchParams, runtimeOptions.query);
    }

    const headers = new Headers(runtimeOptions?.headers);
    const body = runtimeOptions?.body === undefined ? undefined : JSON.stringify(runtimeOptions.body);
    if (body !== undefined && !headers.has("content-type")) {
      headers.set("content-type", "application/json");
    }

    const response = await fetchImpl(url, {
      body,
      headers,
      method: method.toUpperCase(),
      signal: runtimeOptions?.signal,
    });

    return {
      body: (await readJsonBody(response)) as OperationJsonResponse<OperationFor<Path, Method>> | null,
      headers: response.headers,
      raw: response,
      status: response.status,
    };
  }

  return {
    request,
    delete: (path, requestOptions) => request("delete", path, requestOptions),
    get: (path, requestOptions) => request("get", path, requestOptions),
    patch: (path, requestOptions) => request("patch", path, requestOptions),
    post: (path, requestOptions) => request("post", path, requestOptions),
    put: (path, requestOptions) => request("put", path, requestOptions),
  };
}

function applyPathParams(pathTemplate: string, pathParams: Record<string, unknown> | undefined): string {
  return pathTemplate.replace(/\{([^}]+)\}/g, (_, key: string) => {
    const value = pathParams?.[key];
    if (value === undefined || value === null) {
      throw new Error(`Missing path parameter: ${key}`);
    }

    return encodeURIComponent(String(value));
  });
}

function appendQuery(searchParams: URLSearchParams, query: Record<string, unknown>): void {
  for (const [key, rawValue] of Object.entries(query)) {
    if (rawValue === undefined || rawValue === null) {
      continue;
    }

    if (Array.isArray(rawValue)) {
      for (const item of rawValue) {
        if (item === undefined || item === null) {
          continue;
        }
        searchParams.append(key, String(item));
      }
      continue;
    }

    searchParams.append(key, String(rawValue));
  }
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
