import { apiBaseUrl } from "../api";

export function buildAccountHeaders(accountId?: string): Record<string, string> | undefined {
  if (!accountId) {
    return undefined;
  }

  return {
    "x-account-id": accountId
  };
}

export function resolvePath(pathname: string): string {
  const normalized = apiBaseUrl.replace(/\/$/, "");
  return `${normalized}${pathname}`;
}

export async function fetchJson<T>(pathname: string, accountId?: string): Promise<T> {
  const response = await fetch(resolvePath(pathname), {
    headers: {
      ...buildAccountHeaders(accountId)
    },
    method: "GET"
  });

  if (!response.ok) {
    throw new Error(await extractErrorMessage(response));
  }

  return (await response.json()) as T;
}

export async function postJson<T>(pathname: string, body: unknown, accountId?: string): Promise<T> {
  const response = await fetch(resolvePath(pathname), {
    body: JSON.stringify(body),
    headers: {
      "content-type": "application/json",
      ...buildAccountHeaders(accountId)
    },
    method: "POST"
  });

  if (!response.ok) {
    throw new Error(await extractErrorMessage(response));
  }

  return (await response.json()) as T;
}

export async function putJson<T>(pathname: string, body: unknown, accountId?: string): Promise<T> {
  const response = await fetch(resolvePath(pathname), {
    body: JSON.stringify(body),
    headers: {
      "content-type": "application/json",
      ...buildAccountHeaders(accountId)
    },
    method: "PUT"
  });

  if (!response.ok) {
    throw new Error(await extractErrorMessage(response));
  }

  return (await response.json()) as T;
}

export async function patchJson<T>(pathname: string, body: unknown, accountId?: string): Promise<T> {
  const response = await fetch(resolvePath(pathname), {
    body: JSON.stringify(body),
    headers: {
      "content-type": "application/json",
      ...buildAccountHeaders(accountId)
    },
    method: "PATCH"
  });

  if (!response.ok) {
    throw new Error(await extractErrorMessage(response));
  }

  return (await response.json()) as T;
}

export async function deleteJson<T>(pathname: string, accountId?: string): Promise<T> {
  const response = await fetch(resolvePath(pathname), {
    headers: {
      ...buildAccountHeaders(accountId)
    },
    method: "DELETE"
  });

  if (!response.ok) {
    throw new Error(await extractErrorMessage(response));
  }

  return (await response.json()) as T;
}

export async function extractErrorMessage(response: Response): Promise<string> {
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    return `Request failed with status ${response.status}`;
  }

  try {
    const payload = (await response.json()) as { error?: { message?: string } };
    if (payload.error?.message) {
      return payload.error.message;
    }
  } catch {
    return `Request failed with status ${response.status}`;
  }

  return `Request failed with status ${response.status}`;
}
