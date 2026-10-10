/**
 * API helper for local and production deployments.
 * Local dev: leave VITE_API_BASE_URL unset and use /api/... via Vite proxy.
 * Production: set VITE_API_BASE_URL to the public backend base URL.
 */
export function apiUrl(path) {
  const baseUrl = import.meta.env.VITE_API_BASE_URL;
  if (!baseUrl) {
    return path;
  }
  return `${baseUrl.replace(/\/$/, '')}${path}`;
}

export async function apiRequest(path, options = {}) {
  return fetch(apiUrl(path), options);
}
