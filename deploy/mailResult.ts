export function visibleDatabaseError(error: unknown): string {
  const raw = typeof error === "string" ? error : error instanceof Error ? error.message : "Databasefejl";
  return raw
    .replace(/postgres(?:ql)?:\/\/[^\s'"]+/gi, "postgres://…")
    .replace(/\b(password|pwd)\s*=\s*[^\s&]+/gi, "$1=…")
    .replace(/\/\/[^/\s:@]+:[^@\s/]+@/g, "//…@")
    .slice(0, 300);
}

export function mailFailure(body: unknown, status: number): string {
  if (body && typeof body === "object") {
    const message = (body as { message?: unknown }).message;
    if (typeof message === "string" && message.trim()) return visibleDatabaseError(message);
    const code = (body as { error?: unknown }).error;
    if (typeof code === "string" && code.trim()) return visibleDatabaseError(code);
  }
  return `invoice mail was not stored (${status})`;
}

export function confirmedMail(body: unknown, companyId: string): boolean {
  if (!body || typeof body !== "object") return false;
  const row = body as { ok?: unknown; id?: unknown; companyId?: unknown; postgres?: unknown };
  return row.ok === true
    && row.postgres === true
    && row.companyId === companyId
    && typeof row.id === "string"
    && row.id.length > 0;
}
