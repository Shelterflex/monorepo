/**
 * XSS input sanitization utilities.
 * Use these on any user-supplied strings before rendering as HTML
 * or passing to third-party APIs.
 */

/**
 * Strip HTML tags and dangerous attributes from a string.
 * Safe for rendering as plain text.
 */
export function sanitizeText(input: string): string {
  return input
    .replace(/<[^>]*>/g, "")           // strip all HTML tags
    .replace(/javascript:/gi, "")       // remove js: protocol
    .replace(/data:/gi, "")             // remove data: URIs
    .replace(/on\w+\s*=/gi, "")         // remove inline event handlers
    .trim();
}

/**
 * Encode characters that have special meaning in HTML.
 * Use when you must insert user content into HTML context.
 */
export function escapeHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;");
}

/**
 * Sanitize a URL — only allow http/https schemes.
 * Returns null if the URL is unsafe.
 */
export function sanitizeUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (!["http:", "https:"].includes(parsed.protocol)) return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

/**
 * Strip script tags and event handlers from an HTML string.
 * NOTE: For rich HTML rendering prefer a dedicated library like DOMPurify.
 */
export function sanitizeHtml(input: string): string {
  return input
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
    .replace(/on\w+\s*=\s*["'][^"']*["']/gi, "")
    .replace(/javascript:/gi, "")
    .replace(/data:/gi, "");
}
