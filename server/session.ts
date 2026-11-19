export const SESSION_COOKIE = "fragtblik";
export const SESSION_MAX_AGE = 14 * 24 * 60 * 60;

export function sessionTokenFromCookie(header: string): string | null {
  for (const part of header.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === SESSION_COOKIE) return decodeURIComponent(rest.join("="));
  }
  return null;
}

export function forwardedHttps(proto: string | string[] | undefined): boolean {
  const forwarded = Array.isArray(proto) ? proto.join(",") : (proto ?? "");
  return forwarded.split(",").some((item) => item.trim().toLowerCase() === "https");
}

export function sessionCookie(token: string | null, https: boolean): string {
  const secure = https ? "; Secure" : "";
  return token
    ? `${SESSION_COOKIE}=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_MAX_AGE}${secure}`
    : `${SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${secure}`;
}
