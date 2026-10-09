/**
 * API URL configuration for production and development environments.
 * 
 * Production: Set VITE_API_BASE_URL to the public backend URL (e.g., "https://api.example.com")
 * Development: Leave VITE_API_BASE_URL empty to use Vite's local proxy (/api/...)
 * 
 * No private secrets (Telegram tokens, admin keys) should be in frontend code.
 */

const apiBaseUrl = import.meta.env.VITE_API_BASE_URL || '';

/**
 * Construct a full API endpoint URL.
 * - If VITE_API_BASE_URL is set, uses that as the base.
 * - Otherwise, uses relative paths for Vite's local proxy.
 */
export function getApiUrl(endpoint) {
  if (apiBaseUrl) {
    // Production: use configured base URL
    return `${apiBaseUrl}${endpoint}`;
  }
  // Development: use relative path for Vite proxy
  return endpoint;
}
