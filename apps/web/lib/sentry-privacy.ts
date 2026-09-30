const SENSITIVE_KEY = /(?:authorization|cookie|password|secret|token|api[-_]?key|email|payload|body|statement|finding|evidence|upload|file|content|data)/i;
const EMAIL = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const URL_QUERY = /([?&](?:token|code|key|signature|x-amz-[^=]+)=)[^&#\s]+/gi;
const MAX_STRING_LENGTH = 500;

function scrubString(value: string): string {
  const redacted = value.replace(EMAIL, "[redacted-email]").replace(URL_QUERY, "$1[redacted]");
  return redacted.length > MAX_STRING_LENGTH ? `${redacted.slice(0, MAX_STRING_LENGTH)}…` : redacted;
}

function scrubValue(value: unknown, depth = 0): unknown {
  if (depth > 5) return "[redacted-depth]";
  if (typeof value === "string") return scrubString(value);
  if (Array.isArray(value)) return value.slice(0, 50).map((item) => scrubValue(item, depth + 1));
  if (!value || typeof value !== "object") return value;

  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [
      key,
      SENSITIVE_KEY.test(key) ? "[redacted]" : scrubValue(entry, depth + 1),
    ]),
  );
}

function safeUrl(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    const url = new URL(value, "https://closepilot.invalid");
    const path = `${url.origin === "https://closepilot.invalid" ? "" : url.origin}${url.pathname}`;
    return scrubString(path);
  } catch {
    return scrubString(value.split("?")[0]);
  }
}

export function scrubSentryEvent<T extends object>(event: T): T {
  const scrubbed = scrubValue(event) as T;
  const eventRecord = scrubbed as Record<string, unknown>;
  delete eventRecord.user;

  const request = eventRecord.request;
  if (request && typeof request === "object" && !Array.isArray(request)) {
    const safeRequest = request as Record<string, unknown>;
    safeRequest.url = safeUrl(safeRequest.url);
    delete safeRequest.data;
    delete safeRequest.cookies;
    delete safeRequest.query_string;
    delete safeRequest.headers;
  }
  return scrubbed;
}

export function scrubSentryBreadcrumb<T extends object>(breadcrumb: T): T {
  const breadcrumbRecord = breadcrumb as Record<string, unknown>;
  const { data: originalData, ...safeBreadcrumb } = breadcrumbRecord;
  const scrubbed = scrubValue(safeBreadcrumb) as T;
  const scrubbedRecord = scrubbed as Record<string, unknown>;
  if (typeof scrubbedRecord.message === "string") scrubbedRecord.message = scrubString(scrubbedRecord.message);
  if (originalData && typeof originalData === "object" && !Array.isArray(originalData)) {
    scrubbedRecord.data = Object.fromEntries(
      Object.entries(originalData).map(([key, value]) => [
        key,
        SENSITIVE_KEY.test(key) ? "[redacted]" : scrubValue(value),
      ]),
    );
    const data = scrubbedRecord.data as Record<string, unknown>;
    if ("url" in data) data.url = safeUrl(data.url);
  }
  return scrubbed;
}
