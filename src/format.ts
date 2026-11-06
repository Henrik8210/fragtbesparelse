// Danish grouping and a kr. suffix: 1.000.000 kr. Percents use a decimal comma.

export function formatNumber(value: number): string {
  const rounded = Math.round(value);
  const sign = rounded < 0 ? "-" : "";
  const digits = Math.abs(rounded).toString();
  const grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${sign}${grouped}`;
}

export function formatKr(value: number): string {
  return `${formatNumber(value)} kr.`;
}

export function formatPercent(ratio: number): string {
  const negative = ratio < 0;
  const scaled = Math.abs(ratio) * 100;
  const fixed = scaled.toFixed(1);
  const [whole, fraction] = fixed.split(".");
  return `${negative ? "-" : ""}${formatNumber(Number(whole))},${fraction}%`;
}

export function formatCount(value: number): string {
  return formatNumber(value);
}
