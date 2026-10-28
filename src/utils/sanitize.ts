/**
 * Redaction of secrets before anything is logged or returned to Robot Framework
 * (Robot logs keyword arguments and return values at INFO level).
 */
export const REDACTED = '***REDACTED***';

const SENSITIVE_HEADERS = new Set([
  'authorization',
  'proxy-authorization',
  'cookie',
  'set-cookie',
  'x-api-key',
  'x-auth-token',
]);

const SENSITIVE_KEY = /pass(word|wd)?$|secret|token|api[-_]?key|authorization|credential|session[-_]?id/i;

/** True if any segment of a dot path (e.g. `headers.x-api-key`) names a sensitive field. */
export function isSensitivePath(fieldPath: string): boolean {
  return fieldPath.split('.').some((segment) => SENSITIVE_KEY.test(segment) || SENSITIVE_HEADERS.has(segment.toLowerCase()));
}

export function sanitizeHeaders(headers: Record<string, string>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    result[name] = SENSITIVE_HEADERS.has(name.toLowerCase()) ? REDACTED : value;
  }
  return result;
}

/** Deep copy of `value` with values under sensitive keys replaced. */
export function sanitizeBody<T>(value: T, depth = 0): T {
  if (depth > 20 || value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((item) => sanitizeBody(item, depth + 1)) as T;
  const result: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    result[key] = SENSITIVE_KEY.test(key) ? REDACTED : sanitizeBody(item, depth + 1);
  }
  return result as T;
}

/** Compact, sanitized, length-limited rendering of a response body for error messages. */
export function previewBody(body: unknown, maxLength = 500): string {
  if (body === null || body === undefined || body === '') return '<empty>';
  const text = typeof body === 'string' ? body : JSON.stringify(sanitizeBody(body));
  return text.length > maxLength ? `${text.slice(0, maxLength)}... (${text.length} chars)` : text;
}
