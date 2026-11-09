// Reads one invoice total from bill text. A stated total wins. Otherwise the
// money amounts on the lines are added together, skipping VAT lines.

const TOTAL_PATTERN =
  /(?:^|[^a-zæøå])(i alt|grand total|amount due|at betale|fakturatotal|totalbeløb|totalbeloeb|beløb i alt|beloeb i alt|total)(?![a-zæøå])/gi;

const NUMBER_PATTERN =
  /\d{1,3}(?:[.\u00a0]\d{3})+(?:,\d{1,2})?|\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?|\d+(?:[.,]\d{1,2})|\d+/g;

export function parseAmount(raw: string): number | null {
  const token = raw
    .trim()
    .toLowerCase()
    .replace(/\u00a0/g, "")
    .replace(/\s/g, "")
    .replace(/^(?:dkk|kr\.?)/, "")
    .replace(/(?:dkk|kr\.?)$/, "");
  if (!/^\d/.test(token)) return null;
  let value: number | null = null;
  if (/^\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?$/.test(token)) {
    value = Number(token.replaceAll(".", "").replace(",", "."));
  } else if (/^\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?$/.test(token)) {
    value = Number(token.replaceAll(",", ""));
  } else if (/^\d+,\d{1,2}$/.test(token)) {
    value = Number(token.replace(",", "."));
  } else if (/^\d+\.\d{1,2}$/.test(token)) {
    value = Number(token);
  } else if (/^\d+$/.test(token)) {
    value = Number(token);
  }
  if (value == null || !Number.isFinite(value) || value <= 0) return null;
  return Math.round(value * 100) / 100;
}

export function parseBillText(text: string, filename = ""): number | null {
  const source = text.replace(/^\uFEFF/, "");
  const csv = parseCsv(source);
  if (csv != null) return csv;
  if (filename.toLowerCase().endsWith(".csv")) return null;

  const totals: number[] = [];
  for (const match of source.matchAll(TOTAL_PATTERN)) {
    const word = match[1];
    const wordAt = (match.index ?? 0) + match[0].lastIndexOf(word);
    const amount = amountBeside(source, wordAt, word.length);
    if (amount != null) totals.push(amount);
  }
  if (totals.length > 0) return Math.max(...totals);

  let sum = 0;
  let count = 0;
  for (const line of source.split(/\r?\n/)) {
    if (/\b(moms|vat)\b/i.test(line)) continue;
    const amounts = moneyAmounts(line);
    if (amounts.length === 0) continue;
    sum += amounts[amounts.length - 1];
    count += 1;
  }
  return count > 0 ? Math.round(sum * 100) / 100 : null;
}

function parseCsv(text: string): number | null {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length < 2) return null;
  const semicolons = lines[0].match(/;/g)?.length ?? 0;
  const commas = lines[0].match(/,/g)?.length ?? 0;
  if (semicolons === 0 && commas === 0) return null;
  const delimiter = semicolons >= commas ? ";" : ",";
  const rows = lines.map((line) => splitRow(line, delimiter));
  if (rows[0].length < 2) return null;
  const header = rows[0].map((cell) => cell.toLowerCase());
  const amountCol = header.findIndex((cell) =>
    /(beløb|beloeb|amount|pris|price|total|paid|fragt)/.test(cell),
  );
  if (amountCol < 0) return null;

  const parsed: { label: string; amount: number }[] = [];
  for (const row of rows.slice(1)) {
    const amount = parseAmount(row[amountCol] ?? "");
    if (amount == null) continue;
    const label = row.filter((_, index) => index !== amountCol).join(" ").toLowerCase();
    parsed.push({ label, amount });
  }
  if (parsed.length === 0) return null;
  const last = parsed[parsed.length - 1];
  if (parsed.length > 1 && /\b(i alt|total|sum)\b/.test(last.label)) return last.amount;
  const sum = parsed.reduce((total, row) => total + row.amount, 0);
  return Math.round(sum * 100) / 100;
}

function splitRow(line: string, delimiter: string): string[] {
  const cells: string[] = [];
  let current = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"') {
      if (quoted && line[index + 1] === '"') {
        current += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (char === delimiter && !quoted) {
      cells.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  cells.push(current.trim());
  return cells;
}

function amountBeside(text: string, keywordAt: number, keywordLength: number): number | null {
  const after = collectAmounts(text.slice(keywordAt + keywordLength, keywordAt + keywordLength + 48));
  if (after.length > 0) return after[0].amount;
  const before = collectAmounts(text.slice(Math.max(0, keywordAt - 32), keywordAt));
  return before.at(-1)?.amount ?? null;
}

type FoundAmount = { amount: number; raw: string; index: number };

function moneyAmounts(line: string): number[] {
  return collectAmounts(line)
    .filter((found) => {
      const before = line.slice(Math.max(0, found.index - 6), found.index);
      const after = line.slice(found.index + found.raw.length, found.index + found.raw.length + 6);
      const currency = /(?:dkk|kr\.?)\s*$/i.test(before) || /^\s*(?:kr\.?|dkk)/i.test(after);
      return currency || /[.,\u00a0]/.test(found.raw);
    })
    .map((found) => found.amount);
}

function collectAmounts(text: string): FoundAmount[] {
  const amounts: FoundAmount[] = [];
  for (const match of text.matchAll(NUMBER_PATTERN)) {
    const raw = match[0];
    const index = match.index ?? 0;
    if (continuesNumber(text, index, raw)) continue;
    const amount = parseAmount(raw);
    if (amount != null) amounts.push({ amount, raw, index });
  }
  return amounts;
}

function continuesNumber(text: string, index: number, raw: string): boolean {
  const previous = text[index - 1];
  const next = text[index + raw.length];
  if (previous && /\d/.test(previous)) return true;
  if (next && /\d/.test(next)) return true;
  if (previous && /[./-]/.test(previous) && /\d/.test(text[index - 2] ?? "")) return true;
  if (next && /[./-]/.test(next) && /\d/.test(text[index + raw.length + 1] ?? "")) return true;
  return false;
}
