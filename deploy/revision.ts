export const REVISION = "format-alerts";

export function healthMatchesRevision(body: string): boolean {
  return body.split(/\s+/).includes(REVISION);
}
