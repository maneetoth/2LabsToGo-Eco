const DEFAULT_API_BASE_URL = "http://127.0.0.1:8000";

export const API_BASE_URL = (
  process.env.NEXT_PUBLIC_API_BASE_URL?.trim() || DEFAULT_API_BASE_URL
).replace(/\/+$/, "");

export function apiUrl(path: string): string {
  const trimmed = path.trim();
  if (!trimmed) return API_BASE_URL;

  // Allow callers to pass through absolute URLs unchanged
  if (/^https?:\/\//i.test(trimmed)) return trimmed;

  const withLeadingSlash = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
  return `${API_BASE_URL}${withLeadingSlash}`;
}
