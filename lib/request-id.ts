import { randomUUID } from "node:crypto";

const REQUEST_ID_HEADERS = ["x-request-id", "x-correlation-id"] as const;
const REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{4,128}$/;

export function getRequestCorrelationId(request: Request): string {
  for (const headerName of REQUEST_ID_HEADERS) {
    const raw = request.headers.get(headerName);
    if (!raw) {
      continue;
    }

    const value = raw.trim();
    if (REQUEST_ID_PATTERN.test(value)) {
      return value;
    }
  }

  return randomUUID();
}

