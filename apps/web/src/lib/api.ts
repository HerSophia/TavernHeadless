import { createTavernClient } from "@tavern/sdk";

export const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3000";

export const apiClient = createTavernClient({
  baseUrl: apiBaseUrl,
});
