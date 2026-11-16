export function confirmedMail(body: unknown, companyId: string): boolean {
  if (!body || typeof body !== "object") return false;
  const row = body as { ok?: unknown; id?: unknown; companyId?: unknown; postgres?: unknown };
  return row.ok === true
    && row.postgres === true
    && row.companyId === companyId
    && typeof row.id === "string"
    && row.id.length > 0;
}
