import { describe, expect, it } from "vitest";
import { checkPassword, hashPassword } from "./db.ts";
import { loginBlocked, loginFailed, loginSucceeded } from "./loginLimit.ts";
import { MAX_PASSWORD, MIN_PASSWORD, passwordOk } from "./passwordPolicy.ts";
import { forwardedHttps, SESSION_MAX_AGE, sessionCookie, sessionTokenFromCookie } from "./session.ts";

describe("session cookie", () => {
  it("reads the fragtblik token among other cookies", () => {
    expect(sessionTokenFromCookie("a=1; fragtblik=abc123; b=2")).toBe("abc123");
    expect(sessionTokenFromCookie("fragtblik=a%2Fb%3Dc")).toBe("a/b=c");
    expect(sessionTokenFromCookie("fragtblik=x=y")).toBe("x=y");
  });

  it("returns null without the cookie and ignores look-alike names", () => {
    expect(sessionTokenFromCookie("")).toBeNull();
    expect(sessionTokenFromCookie("xfragtblik=1; fragtblik_old=2")).toBeNull();
  });

  it("lasts 14 days and is HttpOnly, SameSite=Lax", () => {
    expect(SESSION_MAX_AGE).toBe(1_209_600);
    expect(sessionCookie("t o/k", false)).toBe("fragtblik=t%20o%2Fk; HttpOnly; SameSite=Lax; Path=/; Max-Age=1209600");
  });

  it("is Secure only behind HTTPS", () => {
    expect(sessionCookie("t", true)).toMatch(/; Secure$/);
    expect(sessionCookie("t", false)).not.toMatch(/Secure/);
  });

  it("clears the cookie on sign-out", () => {
    expect(sessionCookie(null, true)).toBe("fragtblik=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0; Secure");
  });

  it("detects HTTPS from x-forwarded-proto in any form", () => {
    expect(forwardedHttps("https")).toBe(true);
    expect(forwardedHttps("http, HTTPS")).toBe(true);
    expect(forwardedHttps(["http", "https"])).toBe(true);
    expect(forwardedHttps("http")).toBe(false);
    expect(forwardedHttps(undefined)).toBe(false);
  });
});

describe("password policy", () => {
  it("accepts 8 to 80 characters", () => {
    expect(passwordOk("x".repeat(MIN_PASSWORD - 1))).toBe(false);
    expect(passwordOk("x".repeat(MIN_PASSWORD))).toBe(true);
    expect(passwordOk("x".repeat(MAX_PASSWORD))).toBe(true);
    expect(passwordOk("x".repeat(MAX_PASSWORD + 1))).toBe(false);
  });
});

describe("password hashing", () => {
  it("salts each hash and verifies only the right password", async () => {
    const first = await hashPassword("correct horse");
    const second = await hashPassword("correct horse");
    expect(first).toMatch(/^scrypt\$[0-9a-f]{32}\$[0-9a-f]{64}$/);
    expect(first).not.toBe(second);
    expect(await checkPassword("correct horse", first)).toBe(true);
    expect(await checkPassword("correct horsf", first)).toBe(false);
  });

  it("rejects empty or malformed stored hashes", async () => {
    expect(await checkPassword("anything", null)).toBe(false);
    expect(await checkPassword("anything", "plain")).toBe(false);
    expect(await checkPassword("anything", "bcrypt$aa$bb")).toBe(false);
    expect(await checkPassword("anything", "scrypt$aa$00")).toBe(false);
  });
});

describe("login rate limit", () => {
  it("blocks after five failures for fifteen minutes", () => {
    const key = "limit-test";
    const start = 1_000_000;
    for (let i = 0; i < 4; i += 1) loginFailed(key, start);
    expect(loginBlocked(key, start)).toBe(false);
    loginFailed(key, start);
    expect(loginBlocked(key, start)).toBe(true);
    expect(loginBlocked(key, start + 15 * 60 * 1000 - 1)).toBe(true);
    expect(loginBlocked(key, start + 15 * 60 * 1000)).toBe(false);
  });

  it("resets on success and keeps keys separate", () => {
    for (let i = 0; i < 5; i += 1) loginFailed("a", 0);
    expect(loginBlocked("a", 0)).toBe(true);
    expect(loginBlocked("b", 0)).toBe(false);
    loginSucceeded("a");
    expect(loginBlocked("a", 0)).toBe(false);
  });
});
