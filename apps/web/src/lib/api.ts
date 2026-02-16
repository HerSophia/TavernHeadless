import { createApiClient } from "@tavern/shared";

export const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3000";

export const apiClient = createApiClient({
  baseUrl: apiBaseUrl,
});
