const CARRIER_RULES: { name: string; pattern: RegExp }[] = [
  { name: "PostNord", pattern: /post[\s-]?nord/i },
  { name: "Danske Fragtmænd", pattern: /fragtm[aæ]nd|fragtmaend/i },
  { name: "Schenker", pattern: /schenker/i },
  { name: "GLS", pattern: /\bgls\b/i },
  { name: "DHL", pattern: /\bdhl\b/i },
  { name: "DSV", pattern: /\bdsv\b/i },
  { name: "Bring", pattern: /\bbring\b/i },
  { name: "DAO", pattern: /\bdao\b/i },
  { name: "UPS", pattern: /\bups\b/i },
  { name: "Frode Laursen", pattern: /\bfrode[\s_-]*laursen/i },
];

const LABELED = /(?:transport(?:ø|o|oe)r|fragtf(?:ø|o|oe)rer|carrier|leverand(?:ø|o|oe)r)\s*[:-]\s*([^\n\r]{2,60})/i;

/** First carrier named in the text, by rule order. */
export function carrierIn(text: string): string {
  return CARRIER_RULES.find((rule) => rule.pattern.test(text))?.name ?? "";
}

/**
 * Carrier named on an invoice's text layer. A labeled line such as "Transportør: PostNord" wins.
 * Otherwise the carrier mentioned first in the text is the issuer, since a letterhead comes before the lines.
 */
export function carrierInDocument(text: string): string {
  const labeled = LABELED.exec(text)?.[1];
  const fromLabel = labeled ? carrierIn(labeled) : "";
  if (fromLabel) return fromLabel;
  let best = "";
  let at = Number.POSITIVE_INFINITY;
  for (const rule of CARRIER_RULES) {
    const index = text.search(rule.pattern);
    if (index >= 0 && index < at) {
      at = index;
      best = rule.name;
    }
  }
  return best;
}

export type CarrierMail = { sender: string; subject: string; files: { filename: string; carrier?: string }[] };

/** Sender domain, subject and file names first, then a carrier the server read from an attached PDF. */
export function carrierFromMail(mail: CarrierMail): string {
  const quoted = mail.sender.match(/<([^>]+)>/)?.[1] ?? mail.sender;
  const address = quoted.trim().toLowerCase();
  const at = address.lastIndexOf("@");
  const domain = at >= 0 ? address.slice(at + 1) : "";
  const files = mail.files.map((file) => file.filename).join(" ");
  return carrierIn(`${domain} ${mail.subject} ${files}`) || mail.files.find((file) => file.carrier)?.carrier || "";
}
