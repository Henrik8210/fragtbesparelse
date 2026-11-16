export const REVISION = "invoice-mail-file";

export function healthMatchesRevision(body: string): boolean {
  return body.split(/\s+/).includes(REVISION);
}
