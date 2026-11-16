export const REVISION = "db-status";

export function healthMatchesRevision(body: string): boolean {
  return body.split(/\s+/).includes(REVISION);
}
