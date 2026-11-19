import { describe, expect, it } from "vitest";
import { groupByDay, noticeTarget, noticeText, noticeTime, type Notice } from "./notices.ts";

function notice(fields: Partial<Notice>): Notice {
  return { id: "n1", kind: "invoice", name: "", company: "nordhavn-living", email: "", subject: "", createdAt: "2026-11-19T11:50:00.000Z", seenAt: null, ...fields };
}

describe("groupByDay", () => {
  const now = new Date("2026-11-19T12:00:00.000Z");

  it("groups on Copenhagen days, newest first, with I dag and I går", () => {
    const groups = groupByDay([
      notice({ id: "a", createdAt: "2026-11-17T09:00:00.000Z" }),
      notice({ id: "b", createdAt: "2026-11-19T11:50:00.000Z" }),
      notice({ id: "c", createdAt: "2026-11-18T23:30:00.000Z" }),
      notice({ id: "d", createdAt: "2026-11-18T12:00:00.000Z" }),
    ], now);
    expect(groups.map((group) => [group.label, group.items.map((item) => item.id)])).toEqual([
      ["I dag", ["b", "c"]],
      ["I går", ["d"]],
      ["Tirsdag 17. november", ["a"]],
    ]);
  });

  it("adds the year for an earlier year and skips a broken date", () => {
    const groups = groupByDay([notice({ createdAt: "2025-12-24T10:00:00.000Z" }), notice({ id: "x", createdAt: "bad" })], now);
    expect(groups.map((group) => group.label)).toEqual(["Onsdag den 24. december 2025"]);
  });

  it("shows the Copenhagen clock time", () => {
    expect(noticeTime("2026-11-19T11:50:00.000Z")).toBe("12.50");
  });
});

describe("noticeTarget", () => {
  it("opens the received invoice on its company", () => {
    expect(noticeTarget(notice({ id: "mail-1" }))).toEqual({ kind: "invoice", orgId: "nordhavn-living", mailId: "mail-1" });
  });

  it("replies to a demo request and ignores a bad address", () => {
    expect(noticeTarget(notice({ kind: "demo", email: "jesper@example.com" }))).toEqual({
      kind: "mail", href: "mailto:jesper@example.com?subject=Demo%20af%20Freightlytics",
    });
    expect(noticeTarget(notice({ kind: "demo", email: "nope" }))).toBeNull();
  });
});

describe("noticeText", () => {
  it("names the carrier and the organization", () => {
    const text = noticeText(notice({ name: "PostNord", subject: "Test faktura" }), [{ id: "nordhavn-living", name: "Nordhavn Living" }]);
    expect(text).toEqual({ title: "Faktura modtaget fra PostNord", lines: ["Test faktura · Nordhavn Living"], action: "Åbn faktura" });
    expect(noticeText(notice({}), []).title).toBe("Faktura modtaget");
  });
});
