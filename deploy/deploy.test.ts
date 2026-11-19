import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { encodeBase64, headerField, limitMail, packMail, readMailBytes } from "./mailBytes.ts";
import { confirmedMail, mailFailure, visibleDatabaseError } from "./mailResult.ts";
import { healthMatchesRevision, REVISION } from "./revision.ts";

describe("health revision", () => {
  it("is a single token so /health answers `ok <revision>`", () => {
    expect(REVISION).toMatch(/^[a-z0-9-]+$/);
    expect(healthMatchesRevision(`ok ${REVISION}`)).toBe(true);
    expect(healthMatchesRevision(`ok ${REVISION}\n`)).toBe(true);
  });

  it("rejects another revision or a partial match", () => {
    expect(healthMatchesRevision("ok some-older-revision")).toBe(false);
    expect(healthMatchesRevision(`ok ${REVISION}x`)).toBe(false);
    expect(healthMatchesRevision("")).toBe(false);
  });

  it("is what the Node server answers on /health", () => {
    const server = readFileSync(new URL("../server/index.ts", import.meta.url), "utf8");
    expect(server).toContain('import { REVISION } from "../deploy/revision.ts"');
    expect(server).toContain("res.end(`ok ${REVISION}`)");
  });
});

describe("mail results", () => {
  it("only confirms a Postgres row on the same company", () => {
    const ok = { ok: true, postgres: true, companyId: "nordhavn-living", id: "m1" };
    expect(confirmedMail(ok, "nordhavn-living")).toBe(true);
    expect(confirmedMail({ ...ok, postgres: false }, "nordhavn-living")).toBe(false);
    expect(confirmedMail(ok, "vesterbro-cloth")).toBe(false);
    expect(confirmedMail({ ...ok, id: "" }, "nordhavn-living")).toBe(false);
    expect(confirmedMail(null, "nordhavn-living")).toBe(false);
  });

  it("hides connection strings and passwords in errors", () => {
    const message = visibleDatabaseError(new Error("connect postgres://user:secret@db.example:5432/app failed password=hunter2"));
    expect(message).not.toContain("secret");
    expect(message).not.toContain("hunter2");
    expect(message).toContain("postgres://…");
    expect(visibleDatabaseError("x".repeat(500))).toHaveLength(300);
  });

  it("explains a failed store from the body or the status", () => {
    expect(mailFailure({ message: "relation missing" }, 500)).toBe("relation missing");
    expect(mailFailure({ error: "unknown_company" }, 404)).toBe("unknown_company");
    expect(mailFailure("nope", 502)).toBe("invoice mail was not stored (502)");
  });
});

describe("mail bytes", () => {
  it("base64-encodes large inputs like Buffer does", () => {
    const bytes = new Uint8Array(10_000).map((_, i) => (i * 31) % 256);
    expect(encodeBase64(bytes)).toBe(Buffer.from(bytes).toString("base64"));
    expect(JSON.parse(packMail(new Uint8Array([104, 105])))).toEqual({ v: 1, raw: "aGk=" });
  });

  it("limits mail to 8 MB and refuses empty mail", () => {
    expect(limitMail(new Uint8Array(8_000_001))).toBe("large");
    expect(limitMail(new Uint8Array(3))).toHaveLength(3);
    expect(() => limitMail(new Uint8Array())).toThrow(/not read/);
  });

  it("reads arrays, buffers and streams into a copy", async () => {
    const source = new Uint8Array([1, 2, 3]);
    const copy = await readMailBytes(source);
    expect(copy).toEqual(source);
    expect(copy).not.toBe(source);
    expect(await readMailBytes(source.buffer)).toEqual(source);
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array([1, 2]));
        controller.enqueue(new Uint8Array([3]));
        controller.close();
      },
    });
    expect(await readMailBytes(stream)).toEqual(source);
  });

  it("cleans header values to printable ASCII", () => {
    expect(headerField("  Faktura\r\n oktober ")).toBe("Faktura oktober");
    expect(headerField("Ærø <ab@cd.dk>")).toBe("r <ab@cd.dk>");
    expect(headerField("ÆØÅ")).toBe("");
    expect(headerField("x".repeat(400))).toHaveLength(320);
  });
});
