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
const PDF_3PL = readFileSync(new URL("./fixtures/nordlager-3pl-prisaftale-test.pdf", import.meta.url));
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
        { label: "Brændstoftillæg", kind: "percent", value: "12,5", unit: "", scope: "", note: "" },
        { label: "Vejafgift", kind: "amount", value: "2,40", unit: "pr. pakke", scope: "", note: "" },
      ],
      items: [],
      grids: [],
      conditions: [],
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
  assert.equal(prepared.batches.length, 1);
  assert.match(prepared.batches[0].messages[0].content, /price agreements/);
  const job = openJob("skive-plate-works", prepared);
  assert.deepEqual(job.inputs, job.batches[0], "a Worker that only knows `inputs` still runs the first batch");
  const extract = await closeJob(job.id, [modelReply()]);
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

function reply3pl() {
  return {
    response: {
      carrier: "Nordlager Logistik A/S",
      title: "Aftale NL-KTC-2027",
      validFrom: "01.03.2027",
      validTo: "28.02.2028",
      currency: "DKK",
      rates: [],
      items: [
        { category: "Lagerleje", description: "Pallelagerplads", unit: "pr. palle pr. uge", price: "9,40", currency: "DKK", note: "" },
        { category: "Lagerleje", description: "Hyldeplads", unit: "pr. hyldemeter pr. måned", price: "31,75", currency: "DKK", note: "" },
        { category: "Ordreekspedition", description: "Ordregebyr", unit: "pr. ordre", price: "6,85", currency: "DKK", note: "" },
        { category: "Ordreekspedition", description: "Pluk", unit: "pr. ordrelinje", price: "1,92", currency: "DKK", note: "" },
        { category: "Ordreekspedition", description: "Lagerarbejde", unit: "pr. time", price: "412,50", currency: "DKK", note: "" },
      ],
      grids: [{
        name: "Distribution fra Kolding",
        category: "Distribution",
        unit: "pr. leverance",
        currency: "DKK",
        rowLabel: "Pallepladser",
        columns: [{ label: "Jylland/Fyn", detail: "Erhverv" }, { label: "Sjælland", detail: "Erhverv" }, { label: "Bornholm", detail: "Erhverv" }],
        rows: [
          { label: "1 ppl.", cells: ["612,40", "748,90", "1.394,20"] },
          { label: "2-3 ppl.", cells: ["498,15", "611,35", "1.162,80"] },
          // 503,57 is a misread of the printed 503,75.
          { label: "4-6 ppl.", cells: ["401,60", "503,57", "987,45"] },
        ],
        minimum: ["612,40", "748,90", "1.394,20"],
        maximum: ["4.210,00", "5.120,50", "9.875,00"],
        note: "",
      }],
      surcharges: [
        { label: "Olietillæg", kind: "percent", value: "18,40", unit: "", scope: "national kørsel", note: "" },
        { label: "Køletillæg", kind: "percent", value: "+12 %", unit: "", scope: "distributionsprisen", note: "" },
        { label: "Farligt gods (ADR)", kind: "agreed", value: "Skal aftales", unit: "", scope: "", note: "" },
      ],
      conditions: [
        "Priserne er ekskl. moms og offentlige afgifter.",
        "Fakturering sker månedsvis bagud.",
        "Leveringer bestilles senest kl. 12.00 dagen før.",
      ],
    },
    usage: { prompt_tokens: 1200, completion_tokens: 900 },
  };
}

test("reads a 3PL agreement into items, a price grid, surcharges and conditions", async () => {
  const ai = mockAi(reply3pl());
  const done = await extractAgreement("kolding-table-co", "nordlager.pdf", PDF_3PL, ai.run);
  assert.equal(done.result, "extracted");
  if (done.result !== "extracted") return;
  const extract = done.extract;
  assert.equal(extract.version, 5);
  assert.equal(extract.validFrom, "2027-03-01");
  assert.deepEqual(extract.items.map((item) => [item.unit, item.price]), [
    ["pr. palle pr. uge", 9.4], ["pr. hyldemeter pr. måned", 31.75], ["pr. ordre", 6.85], ["pr. ordrelinje", 1.92], ["pr. time", 412.5],
  ]);
  const grid = extract.grids[0];
  assert.deepEqual(grid.rows[2].cells, [401.6, 503.57, 987.45]);
  assert.deepEqual(grid.maximum, [4210, 5120.5, 9875]);
  assert.deepEqual(grid.unprinted, ["2:1"], "only the misread cell is flagged");
  assert.deepEqual(extract.surcharges.map((item) => [item.kind, item.value]), [["percent", 18.4], ["percent", 12], ["agreed", null]]);
  assert.ok(extract.conditions.every((item) => item.printed));
  assert.deepEqual(extract.coverage, { printed: 18, captured: 17 });
  assert.equal(extract.confidence, "medium");
  assert.equal(extract.usage?.inputTokens, 1200);
});

test("a long agreement is read in page groups and the replies are merged", async () => {
  const prepared = await prepareExtract("kolding-table-co", "n.pdf", PDF_3PL, true, "agreement");
  assert.equal(prepared.result, "ready");
  if (prepared.result !== "ready") return;
  const job = openJob("kolding-table-co", prepared);
  const half = reply3pl();
  const items = { response: { ...half.response, grids: [], surcharges: [], conditions: [] }, usage: { prompt_tokens: 10, completion_tokens: 5 } };
  const rest = { response: { ...half.response, title: "", items: [] }, usage: { prompt_tokens: 20, completion_tokens: 7 } };
  const extract = await closeJob(job.id, [items, "not json", rest]);
  if (extract === "missing" || !("kind" in extract)) return assert.fail("expected an agreement extract");
  assert.equal(extract.chunks, 3);
  assert.equal(extract.items.length, 5);
  assert.equal(extract.grids.length, 1);
  assert.equal(extract.confidence, "low", "an unread part keeps confidence low");
  assert.ok(extract.issues.includes("1 af 3 dele af PDF'en kunne ikke læses."));
  assert.deepEqual(extract.usage && [extract.usage.inputTokens, extract.usage.outputTokens], [30, 12]);
});

test("runParts reports progress, and retries a stuck part once", async () => {
  const { runParts } = await import("./invoiceExtract.ts");
  const seen: string[] = [];
  let stuck = 0;
  const { outputs, reports } = await runParts(
    async (_model, inputs) => (inputs as { stuck?: boolean }).stuck && stuck++ === 0 ? new Promise(() => undefined) : { ok: true },
    [{ stuck: false }, { stuck: true }, { stuck: false }] as never[],
    [],
    (done, total) => seen.push(`${done}/${total}`),
    50,
    2,
  );
  assert.deepEqual(outputs, [{ ok: true }, { ok: true }, { ok: true }]);
  assert.deepEqual(reports.map((report) => report.retried), [false, true, false]);
  assert.deepEqual(seen, ["1/3", "2/3", "3/3"]);
});

// Three pages: prose with a few prices, a page dense with grid cells, and price lines. The production read of a real
// 17-page agreement lost its dense page this way: the reply parsed as a valid part with empty arrays.
const DENSE_PAGES = [
  ["Prisaftale for Kunde Handel", "Gyldig fra 01.01.2027 til 31.12.2027", "Lagerleje pr. uge  31,50  DKK", "Pluk pr. kolli  1,75  DKK", "Med venlig hilsen", "Nord Fragt A/S, Havnevej 1", "Side 1 af 3"].join("\n"),
  [
    ...["Nord", "Syd", "Vest", "Øst"].flatMap((region, at) => [
      `Distribution til ${region}`,
      "Pallepladser  Aarby  Bstrup  Cby  Dby",
      ...Array.from({ length: 6 }, (_, row) => `${row + 1} ppl.  ${[0, 1, 2, 3].map((column) => `${100 + at * 37 + row * 11 + column},${String(10 + row + column * 7 + at).padStart(2, "0")}`).join("  ")}`),
    ]),
    "Side 2 af 3",
  ].join("\n"),
  ["Pallebytte pr. palle  9,86  DKK", "Bokstrailer pr. dag  697,74  DKK", "Side 3 af 3"].join("\n"),
].join("\n\n");

const unwrap = (output: unknown) => (output as { response?: unknown } | null)?.response ?? null;

/** A model that returns every price line of its part as an item and every table row as a grid row. */
function echoModel(lose: (text: string, call: number) => boolean) {
  let calls = 0;
  return async (_model: string, inputs: unknown) => {
    calls += 1;
    const text = String((inputs as { messages: { content: string }[] }).messages[1].content);
    if (lose(text, calls)) return { response: { carrier: "NF", title: "", validFrom: "", validTo: "", currency: "DKK", rates: [], items: [], grids: [], surcharges: [], conditions: [] } };
    const items = [...text.matchAll(/^(.+?)  (\d+,\d{2})  DKK$/gm)].map((match) => ({ category: "", description: match[1], unit: "", price: match[2], currency: "DKK", note: "" }));
    const grids: unknown[] = [];
    let grid: { name: string; columns: { label: string; detail: string }[]; rows: { label: string; cells: string[] }[] } | null = null;
    for (const line of text.split("\n")) {
      if (line.startsWith("Distribution til")) grids.push(grid = { name: line, columns: [], rows: [] });
      else if (grid && line.startsWith("Pallepladser")) grid.columns = line.split("  ").slice(1).map((label) => ({ label, detail: "" }));
      else if (grid && /ppl\./.test(line)) grid.rows.push({ label: line.split("  ")[0], cells: line.split("  ").slice(1) });
    }
    return {
      response: {
        carrier: "NF", title: "", validFrom: "01.01.2027", validTo: "31.12.2027", currency: "DKK", rates: [], items,
        grids: grids.map((item) => ({ ...(item as object), category: "", unit: "", currency: "DKK", rowLabel: "Pallepladser", minimum: [], maximum: [], note: "" })),
        surcharges: [], conditions: [],
      },
    };
  };
}

test("a dense page that comes back empty is read again and nothing is lost", async () => {
  const { runParts } = await import("./invoiceExtract.ts");
  const { buildAgreementBatches, validateAgreementExtract } = await import("../src/pilot/agreementExtract.ts");
  const { batches, plans } = buildAgreementBatches(DENSE_PAGES);
  assert.ok(plans.filter((plan) => plan.pages[0] <= 2 && plan.pages[1] >= 2).length >= 2, "the dense page is split over parts");
  assert.ok(plans.every((plan) => plan.prices.length <= 60));
  const lostOnce = new Set<string>();
  const model = echoModel((text) => {
    if (!text.includes("Distribution til Syd") || text.includes("half") || lostOnce.has("syd")) return false;
    lostOnce.add("syd");
    return true;
  });
  const { outputs, reports } = await runParts(model, batches, plans, undefined, 1000, 4);
  const extract = validateAgreementExtract(outputs.map(unwrap), DENSE_PAGES, { sha256: "x", filename: "aftale.pdf", parts: reports });
  assert.ok(reports.some((report) => report.retried && !report.failed));
  assert.equal(extract.coverage.captured, extract.coverage.printed, "every printed price is in the extract");
  assert.equal(extract.grids.length, 4);
  assert.equal(extract.carrier, "Nord Fragt", "an abbreviation in the reply becomes the company's printed name");
  assert.deepEqual(extract.issues, []);
});

test("a dense page that stays empty is named in the review", async () => {
  const { runParts } = await import("./invoiceExtract.ts");
  const { buildAgreementBatches, validateAgreementExtract } = await import("../src/pilot/agreementExtract.ts");
  const { batches, plans } = buildAgreementBatches(DENSE_PAGES);
  const { outputs, reports } = await runParts(echoModel((text) => text.includes("ppl.")), batches, plans, undefined, 1000, 4);
  const extract = validateAgreementExtract(outputs.map(unwrap), DENSE_PAGES, { sha256: "x", filename: "aftale.pdf", parts: reports });
  assert.equal(extract.confidence, "low");
  assert.ok(extract.issues.some((issue) => /^Side 1–2 blev kun delvist læst \(\d+ af \d+ priser\), også ved andet forsøg/.test(issue)), extract.issues.join(" | "));
});
