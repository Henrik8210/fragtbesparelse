import { expect, test } from "vitest";
import type { CheckLine } from "../src/pilot/invoiceCheck.ts";

delete process.env.DATABASE_URL;

const { checkStore, listChecks, readCheck, saveCheck } = await import("./invoiceCheck.ts");

const line: CheckLine = {
  kind: "shipment", shipment: "", reference: "Linje 1", date: "2026-11-16", service: "Pakke", zone: "Taastrup til Aarhus", weightKg: 2, amountOre: 8500, origin: "DK", destination: "DK",
};

test("keeps checks in memory without the invoice_checks table and keeps the first original", async () => {
  expect(checkStore()).toBe("memory");
  expect(await readCheck("nordhavn-living", "file-1")).toBeNull();
  const first = await saveCheck({ companyId: "nordhavn-living", fileId: "file-1", original: [line], lines: [line], by: "u1", name: "Henrik" });
  expect(first.store).toBe("memory");
  expect(first.check.changed).toBe(false);
  const edited = { ...line, amountOre: 8000 };
  const second = await saveCheck({ companyId: "nordhavn-living", fileId: "file-1", original: [edited], lines: [edited], by: "u2", name: "Jesper" });
  expect(second.check.original).toEqual([line]);
  expect(second.check).toMatchObject({ changed: true, checkedByName: "Jesper" });
  expect((await readCheck("nordhavn-living", "file-1"))?.lines).toEqual([edited]);
  expect((await listChecks("nordhavn-living")).checks).toEqual([
    { fileId: "file-1", changed: true, checkedByName: "Jesper", checkedAt: second.check.checkedAt },
  ]);
  expect((await listChecks("vesterbro-cloth")).checks).toEqual([]);
});
