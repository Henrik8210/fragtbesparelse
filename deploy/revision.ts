export const REVISION = "fast-download";

export function healthMatchesRevision(body: string): boolean {
  return body.split(/\s+/).includes(REVISION);
}
