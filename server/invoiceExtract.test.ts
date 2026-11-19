import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "vitest";

delete process.env.DATABASE_URL;
delete process.env.CLOUDFLARE_AI_TOKEN;

const { extractInvoice, prepareExtract, closeJob, openJob, takeRun } = await import("./invoiceExtract.ts");
const { pdfText } = await import("./pdfText.ts");
const {
  EXTRACT_MODEL, extractToInvoiceRows, isoDate, parseModelOutput, sharedSurchargeOre, validateExtract,
} = await import("../src/pilot/invoiceExtract.ts");

const PDF = readFileSync(new URL("./fixtures/nordhavn-living-testfaktura.pdf", import.meta.url));

// What Workers AI returns for the fixture: `response` is the schema-shaped object, `usage` the token counts.
function modelReply(overrides: Record<string, unknown> = {}) {
  return {
    response: {
      carrier: "PostNord",
      invoiceNumber: "NL-2026-001",
      invoiceDate: "2026-11-16",
      currency: "DKK",
      subtotal: 0,
      vat: 0,
      total: 223.5,
      lines: [
        { kind: "shipment", shipment: "", date: "", reference: "Linje 1", service: "Pakke", weightKg: 2, zone: "Taastrup til Aarhus", origin: "DK", destination: "DK", amount: 85, surcharges: [] },
        { kind: "shipment", shipment: "", date: "", reference: "Linje 2", service: "Pakke", weightKg: 5, zone: "Taastrup til Odense", origin: "DK", destination: "DK", amount: 120, surcharges: [] },
        { kind: "surcharge", shipment: "", date: "", reference: "Linje 3", service: "Braendstoftillaeg", weightKg: 0, zone: "", origin: "", destination: "", amount: 18.5, surcharges: [] },
      ],
      ...overrides,
    },
    usage: { prompt_tokens: 900, completion_tokens: 420 },
  };
}

function mockAi(reply: unknown) {
  const calls: { model: string; inputs: { messages: { content: string }[]; response_format: { type: string } } }[] = [];
  const run = async (model: string, inputs: unknown) => {
    calls.push({ model, inputs: inputs as (typeof calls)[number]["inputs"] });
    return reply;
  };
  return { run, calls };
}

test("reads the text layer of the test invoice", async () => {
  const text = await pdfText(PDF);
  assert.match(text, /Fakturanr: NL-2026-001/);
  assert.match(text, /Linje 2\s+Pakke 5 kg\s+Taastrup til Odense\s+120,00 kr/);
  assert.match(text, /I alt\s+223,50 kr/);
});

test("extracts, sum-checks and caches the test invoice with a mocked model", async () => {
  const ai = mockAi(modelReply());
  const first = await extractInvoice("nordhavn-living", "nordhavn-living-testfaktura.pdf", PDF, ai.run);
  assert.equal(first.result, "extracted");
  assert.equal(ai.calls.length, 1);
  assert.equal(ai.calls[0].model, EXTRACT_MODEL);
  assert.equal(ai.calls[0].inputs.response_format.type, "json_schema");
  assert.match(ai.calls[0].inputs.messages[1].content, /223,50 kr/);

  if (first.result !== "extracted") return;
  const extract = first.extract;
  assert.equal(extract.carrier, "PostNord");
  assert.equal(extract.lines.length, 3);
  assert.deepEqual(extract.check, { lineSumOre: 22350, targetOre: 22350, against: "total", differenceOre: 0, status: "match" });
  assert.equal(extract.confidence, "high");
  assert.deepEqual(extract.issues, []);
  assert.ok(extract.usage && extract.usage.usd > 0 && extract.usage.usd < 0.01);

  const again = await extractInvoice("nordhavn-living", "nordhavn-living-testfaktura.pdf", PDF, ai.run);
  assert.equal(again.result, "cached");
  assert.equal(ai.calls.length, 1, "a cached file does not call the model again");

  const otherCompany = await prepareExtract("vesterbro-cloth", "x.pdf", PDF);
  assert.equal(otherCompany.result, "ready", "the cache is per company");
});

test("turns the extract into check rows and spreads the invoice-level surcharge", async () => {
  const ai = mockAi(modelReply());
  const done = await extractInvoice("kolding-table-co", "f.pdf", PDF, ai.run);
  assert.equal(done.result, "extracted");
  if (done.result !== "extracted") return;
  assert.equal(sharedSurchargeOre(done.extract), 1850);
  const rows = extractToInvoiceRows(done.extract);
  assert.deepEqual(rows.map((row) => [row.shipment, row.date, row.service, row.weight, row.billedOre]), [
    ["Linje 1", "2026-11-16", "Pakke", 2, 9267],
    ["Linje 2", "2026-11-16", "Pakke", 5, 13083],
  ]);
  assert.equal(rows.reduce((sum, row) => sum + row.billedOre, 0), 22350);
});

test("flags an amount the PDF does not contain and a total that does not add up", async () => {
  const reply = modelReply();
  reply.response.lines[1] = { ...reply.response.lines[1], amount: 210 };
  const ai = mockAi(reply);
  const done = await extractInvoice("horsens-gearworks", "f.pdf", PDF, ai.run);
  assert.equal(done.result, "extracted");
  if (done.result !== "extracted") return;
  assert.equal(done.extract.check.status, "mismatch");
  assert.equal(done.extract.check.differenceOre, 9000);
  assert.equal(done.extract.confidence, "low");
  assert.deepEqual(done.extract.lines[1].issues, ["Beløbet står ikke ordret i PDF'en."]);
  assert.ok(done.extract.issues.includes("Linjerne summer ikke til fakturaens total."));
});

test("bridge job: the container opens a job and validates the output the Worker posts back", async () => {
  const prepared = await prepareExtract("skive-plate-works", "f.pdf", PDF);
  assert.equal(prepared.result, "ready");
  if (prepared.result !== "ready") return;
  const job = openJob("skive-plate-works", prepared);
  assert.equal(job.model, EXTRACT_MODEL);
  const extract = await closeJob(job.id, modelReply());
  assert.notEqual(extract, "missing");
  assert.equal(await closeJob(job.id, modelReply()), "missing", "a job closes once");
  assert.equal((await prepareExtract("skive-plate-works", "f.pdf", PDF)).result, "cached");
});

test("rejects files that are not PDFs or have no text layer", async () => {
  assert.equal((await prepareExtract("esbjerg-rig-supply", "a.csv", Buffer.from("a;b\n1;2\n"))).result, "not-pdf");
  const blank = Buffer.from("%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Count 1/Kids[3 0 R]>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 595 842]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n");
  assert.equal((await prepareExtract("esbjerg-rig-supply", "scan.pdf", blank)).result, "no-text");
});

test("parses model output given as a string and rejects non-JSON", () => {
  assert.deepEqual(parseModelOutput({ response: 'Here you go: {"lines":[]} ' }), { lines: [] });
  assert.throws(() => parseModelOutput({ response: "no json here" }), /JSON/);
  assert.throws(() => validateExtract({ lines: "nope" }, "", { sha256: "x", filename: "f" }), /skema/);
});

test("coerces Danish number strings and dates", () => {
  const extract = validateExtract({
    carrier: "GLS", invoiceNumber: "1", invoiceDate: "16.11.2026", currency: "dkk",
    subtotal: "1.234,56", vat: "308,64", total: "1.543,20",
    lines: [{ kind: "shipment", shipment: "00370", date: "2 okt 2026", reference: "", service: "Pakkeshop", weightKg: "1,5", zone: "", origin: "Danmark", destination: "dk", amount: "1.234,56", surcharges: [] }],
  }, "00370 Pakkeshop 1,5 kg 1.234,56 Moms 308,64 I alt 1.543,20", { sha256: "x", filename: "f.pdf" });
  assert.equal(extract.invoiceDate, "2026-11-16");
  assert.equal(extract.currency, "DKK");
  assert.equal(extract.lines[0].amountOre, 123456);
  assert.equal(extract.lines[0].weightKg, 1.5);
  assert.equal(extract.lines[0].date, "2026-10-02");
  assert.equal(extract.lines[0].origin, "DK");
  assert.equal(extract.check.against, "subtotal");
  assert.equal(extract.confidence, "high");
  assert.equal(isoDate("16 Nov 2026"), "2026-11-16");
  assert.equal(isoDate("31-02-2026"), "");
});

test("caps model calls per user per hour", () => {
  const start = 1_000_000;
  for (let index = 0; index < 60; index += 1) assert.equal(takeRun("u1", start + index), true);
  assert.equal(takeRun("u1", start + 61), false);
  assert.equal(takeRun("u2", start + 61), true);
  assert.equal(takeRun("u1", start + 3_600_001 + 60), true);
});
