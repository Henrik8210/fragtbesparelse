export const REVISION = "ci";

export function healthMatchesRevision(body: string): boolean {
  return body.split(/\s+/).includes(REVISION);
}
