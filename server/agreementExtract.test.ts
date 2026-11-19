import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "vitest";

delete process.env.DATABASE_URL;
delete process.env.CLOUDFLARE_AI_TOKEN;

const { closeJob, extractAgreement, extractInvoice, openJob, prepareExtract } = await import("./invoiceExtract.ts");
const { pdfText } = await import("./pdfText.ts");
const { EXTRACT_MODEL } = await import("../src/pilot/invoiceExtract.ts");
const { AGREEMENT_NO_TEXT } = await import("../src/pilot/agreementExtract.ts");

const PDF = readFileSync(new URL("./fixtures/gls-prisaftale-test.pdf", import.meta.url));
const INVOICE_PDF = readFileSync(new URL("./fixtures/nordhavn-living-testfaktura.pdf", import.meta.url));

function modelReply() {
  return {
    response: {
      carrier: "GLS Danmark",
      title: "GLS-NH-2027",
      validFrom: "01.01.2027",
      validTo: "2027-12-31",
      currency: "DKK",
      surcharges: [
        { label: "Brændstoftillæg", percent: 12.5, amount: 0 },
        { label: "Vejafgift", percent: 0, amount: 2.4 },
      ],
      rates: [
        { service: "Pakkeshop", zone: "", maxWeightKg: 1, price: 38.5, fuelPercent: 0, fixedSurcharge: 0 },
        { service: "Pakkeshop", zone: "", maxWeightKg: 5, price: 46, fuelPercent: 0, fixedSurcharge: 0 },
        { service: "Pakkeshop", zone: "", maxWeightKg: 10, price: 62.75, fuelPercent: 0, fixedSurcharge: 0 },
        { service: "Hjemmelevering", zone: "", maxWeightKg: 5, price: 69, fuelPercent: 0, fixedSurcharge: 0 },
        { service: "Hjemmelevering", zone: "", maxWeightKg: 20, price: 94.5, fuelPercent: 0, fixedSurcharge: 0 },
      ],
    },
    usage: { prompt_tokens: 700, completion_tokens: 380 },
  };
}

function mockAi(reply: unknown) {
  const calls: { model: string; inputs: { messages: { content: string }[]; response_format: { json_schema: { required: string[] } } } }[] = [];
  return {
    calls,
    run: async (model: string, inputs: unknown) => {
      calls.push({ model, inputs: inputs as (typeof calls)[number]["inputs"] });
      return reply;
    },
  };
}

test("reads the text layer of the test agreement", async () => {
  const text = await pdfText(PDF);
  assert.match(text, /Pakkeshop\s+1-5 kg\s+46,00 kr/);
  assert.match(text, /Brændstoftillæg 12,5 %/);
});

test("extracts the agreement's rates with the agreement prompt and caches them apart from invoices", async () => {
  const ai = mockAi(modelReply());
  const done = await extractAgreement("nordhavn-living", "gls-prisaftale-test.pdf", PDF, ai.run);
  assert.equal(done.result, "extracted");
  assert.equal(ai.calls[0].model, EXTRACT_MODEL);
  assert.match(ai.calls[0].inputs.messages[0].content, /price agreements/);
  assert.ok(ai.calls[0].inputs.response_format.json_schema.required.includes("rates"));
  if (done.result !== "extracted") return;
  const extract = done.extract;
  assert.equal(extract.kind, "agreement");
  assert.equal(extract.validFrom, "2027-01-01");
  assert.equal(extract.validTo, "2027-12-31");
  assert.equal(extract.confidence, "high");
  assert.deepEqual(extract.issues, []);
  assert.deepEqual(extract.rates.map((rate) => [rate.service, rate.maxWeight, rate.baseOre, rate.fuelPct, rate.fixedOre]), [
    ["Pakkeshop", 1, 3850, 12.5, 240],
    ["Pakkeshop", 5, 4600, 12.5, 240],
    ["Pakkeshop", 10, 6275, 12.5, 240],
    ["Hjemmelevering", 5, 6900, 12.5, 240],
    ["Hjemmelevering", 20, 9450, 12.5, 240],
  ]);

  const again = await extractAgreement("nordhavn-living", "gls-prisaftale-test.pdf", PDF, ai.run);
  assert.equal(again.result, "cached");
  assert.equal(ai.calls.length, 1);
  assert.equal((await prepareExtract("nordhavn-living", "f.pdf", PDF)).result, "ready", "an invoice read of the same bytes is a separate cache entry");
});

test("an invoice cached for a file does not answer an agreement read of it", async () => {
  const invoiceAi = mockAi({ response: { carrier: "PostNord", invoiceNumber: "", invoiceDate: "2026-11-16", currency: "DKK", subtotal: 0, vat: 0, total: 0, lines: [] } });
  await extractInvoice("vesterbro-cloth", "f.pdf", INVOICE_PDF, invoiceAi.run);
  assert.equal((await prepareExtract("vesterbro-cloth", "f.pdf", INVOICE_PDF, false, "agreement")).result, "ready");
});

test("bridge job carries the agreement kind back through the Worker", async () => {
  const prepared = await prepareExtract("skive-plate-works", "a.pdf", PDF, false, "agreement");
  assert.equal(prepared.result, "ready");
  if (prepared.result !== "ready") return;
  assert.match(prepared.inputs.messages[0].content, /price agreements/);
  const job = openJob("skive-plate-works", prepared);
  const extract = await closeJob(job.id, modelReply());
  assert.ok(extract !== "missing" && "kind" in extract && extract.kind === "agreement");
  assert.equal((await prepareExtract("skive-plate-works", "a.pdf", PDF, false, "agreement")).result, "cached");
});

test("an image-only PDF is refused before the model is called", async () => {
  const blank = Buffer.from("%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Count 1/Kids[3 0 R]>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 595 842]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n");
  const ai = mockAi(modelReply());
  const done = await extractAgreement("esbjerg-rig-supply", "scan.pdf", blank, ai.run);
  assert.equal(done.result, "no-text");
  assert.equal(ai.calls.length, 0);
  assert.match(AGREEMENT_NO_TEXT, /kun et billede/);
});
