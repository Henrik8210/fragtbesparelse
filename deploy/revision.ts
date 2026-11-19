export const REVISION = "invoice-viewer-fixes";

export function healthMatchesRevision(body: string): boolean {
  return body.split(/\s+/).includes(REVISION);
}
