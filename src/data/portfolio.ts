// Fictional companies and synthetic freight figures. Not a pricing model.
import type { CauseId, Customer } from "../types.ts";

export const MONTHS: { id: string; label: string; short: string }[] = [
  { id: "2025-11", label: "November 2025", short: "Nov" },
  { id: "2025-12", label: "December 2025", short: "Dec" },
  { id: "2026-01", label: "January 2026", short: "Jan" },
  { id: "2026-02", label: "February 2026", short: "Feb" },
  { id: "2026-03", label: "March 2026", short: "Mar" },
  { id: "2026-04", label: "April 2026", short: "Apr" },
  { id: "2026-05", label: "May 2026", short: "May" },
  { id: "2026-06", label: "June 2026", short: "Jun" },
  { id: "2026-07", label: "July 2026", short: "Jul" },
  { id: "2026-08", label: "August 2026", short: "Aug" },
  { id: "2026-09", label: "September 2026", short: "Sep" },
  { id: "2026-10", label: "October 2026", short: "Oct" },
];

export const LATEST_MONTH = MONTHS[MONTHS.length - 1].label;

export const CAUSES: { id: CauseId; title: string; short: string }[] = [
  {
    id: "express",
    title: "Express used where a cheaper service would still arrive on time",
    short: "Express",
  },
  {
    id: "consolidation",
    title: "Shipments that should have been consolidated",
    short: "Consolidation",
  },
  {
    id: "dimensional",
    title: "Charged for the size of the package, not the weight",
    short: "Box size",
  },
  {
    id: "fuel",
    title: "Fuel and extra fees outside the contract",
    short: "Extra fees",
  },
  {
    id: "contract",
    title: "Agreed rates not used on the invoice",
    short: "Contract rate",
  },
  {
    id: "split",
    title: "One lane split across too many carriers",
    short: "Split carriers",
  },
];

export const customers: Customer[] = [
  {
    id: "nordhavn-living",
    name: "Nordhavn Living",
    industry: "Ecommerce",
    place: "Taastrup",
    description:
      "Home-goods shop shipping parcels and some pallets from a warehouse in Taastrup.",
    explanations: {
      express:
        "Parcels to Copenhagen, Hamburg, and Stockholm went out as express. On these lanes a standard service still arrives inside the delivery date the shop shows the customer, so the express fee buys nothing the promise required.",
      consolidation:
        "Orders for Aarhus, Odense, and Aalborg left as separate parcels through the day. One departure for each city would have paid for fewer pickups and fewer labels.",
      dimensional:
        "Lamps, textiles, and flat-pack furniture for Berlin and Malmö were priced on the size of the carton, well above the weight on the scale. Carriers call the rule dimensional weight. Tighter packaging on the worst items closes most of this gap.",
      fuel:
        "Fuel and remote-area fees on the Rotterdam groupage and the island deliveries sit above the amounts in the carrier agreement.",
      contract:
        "Domestic pallets with Danske Fragtmænd were billed above the rate card that is already signed. The shipments qualify for the agreed price. The invoice did not use it.",
      split:
        "The Netherlands flow is shared by four carriers. None of them sees enough of the lane to price it as a primary route.",
    },
    months: [
      { paid: 1_142_000, benchmark: 912_800 },
      { paid: 1_286_500, benchmark: 1_018_400 },
      { paid: 748_200, benchmark: 618_400 },
      { paid: 692_800, benchmark: 574_600 },
      { paid: 804_600, benchmark: 658_200 },
      { paid: 836_400, benchmark: 681_500 },
      { paid: 871_200, benchmark: 706_400 },
      { paid: 854_700, benchmark: 695_800 },
      { paid: 790_300, benchmark: 648_200 },
      { paid: 868_900, benchmark: 706_100 },
      { paid: 946_200, benchmark: 764_900 },
      { paid: 1_018_400, benchmark: 814_600 },
    ],
    lanes: [
      { origin: "Taastrup", destination: "Copenhagen", carrier: "GLS", service: "Express parcel", shipments: 1840, paid: 186_400, benchmark: 157_800, causeId: "express" },
      { origin: "Taastrup", destination: "Hamburg", carrier: "DHL", service: "Express parcel", shipments: 420, paid: 142_800, benchmark: 116_400, causeId: "express" },
      { origin: "Taastrup", destination: "Stockholm", carrier: "UPS", service: "Express Saver", shipments: 210, paid: 98_200, benchmark: 80_800, causeId: "express" },
      { origin: "Taastrup", destination: "Aarhus", carrier: "PostNord", service: "Parcel", shipments: 960, paid: 74_600, benchmark: 52_500, causeId: "consolidation" },
      { origin: "Taastrup", destination: "Odense", carrier: "DAO", service: "Parcel", shipments: 710, paid: 51_800, benchmark: 37_400, causeId: "consolidation" },
      { origin: "Taastrup", destination: "Aalborg", carrier: "Bring", service: "Parcel", shipments: 540, paid: 46_200, benchmark: 34_500, causeId: "consolidation" },
      { origin: "Taastrup", destination: "Berlin", carrier: "DHL", service: "Parcel", shipments: 380, paid: 112_400, benchmark: 92_600, causeId: "dimensional" },
      { origin: "Taastrup", destination: "Malmö", carrier: "PostNord", service: "Parcel", shipments: 260, paid: 64_900, benchmark: 53_100, causeId: "dimensional" },
      { origin: "Taastrup", destination: "Rotterdam", carrier: "DSV", service: "Road groupage", shipments: 48, paid: 86_500, benchmark: 74_100, causeId: "fuel" },
      { origin: "Taastrup", destination: "Danish islands", carrier: "GLS", service: "Parcel, island fee", shipments: 190, paid: 28_700, benchmark: 22_200, causeId: "fuel" },
      { origin: "Taastrup", destination: "Domestic B2B", carrier: "Danske Fragtmænd", service: "Pallet", shipments: 86, paid: 79_400, benchmark: 57_900, causeId: "contract" },
      { origin: "Taastrup", destination: "Netherlands", carrier: "Four carriers", service: "Parcel", shipments: 310, paid: 46_500, benchmark: 35_300, causeId: "split" },
    ],
  },
  {
    id: "vesterbro-cloth",
    name: "Vesterbro Cloth",
    industry: "Ecommerce",
    place: "Brøndby",
    description:
      "Fashion shop shipping many small parcels, including size-swap reships, from a warehouse in Brøndby.",
    explanations: {
      express:
        "Copenhagen and German orders left on express even when the buyer had not paid for rush delivery. Economy service still meets the shop's stated window on both lanes.",
      consolidation:
        "Single items and size-swaps to Jutland and Funen shipped as their own parcels. A same-day cutoff would have put them in one bag per city.",
      dimensional:
        "Soft garments in oversized mailers to Sweden were billed for the empty space in the bag. The weight of the clothes was not what set the price.",
      fuel: "The Norway parcels include a fuel surcharge above the cap written into the contract.",
      contract:
        "Part of the domestic PostNord billing used the public list price. The account rate was active that month. It was just not the rate on those invoices.",
      split:
        "Web orders into the EU move on three carriers, so the flow is priced as occasional volume rather than a committed lane.",
    },
    months: [
      { paid: 512_400, benchmark: 418_600 },
      { paid: 624_800, benchmark: 498_200 },
      { paid: 286_400, benchmark: 241_800 },
      { paid: 254_600, benchmark: 216_200 },
      { paid: 312_800, benchmark: 261_400 },
      { paid: 348_200, benchmark: 289_600 },
      { paid: 361_500, benchmark: 299_400 },
      { paid: 298_400, benchmark: 251_200 },
      { paid: 246_800, benchmark: 209_400 },
      { paid: 334_600, benchmark: 278_900 },
      { paid: 402_300, benchmark: 332_800 },
      { paid: 438_750, benchmark: 361_200 },
    ],
    lanes: [
      { origin: "Brøndby", destination: "Copenhagen", carrier: "GLS", service: "Express parcel", shipments: 620, paid: 68_400, benchmark: 54_200, causeId: "express" },
      { origin: "Brøndby", destination: "Germany", carrier: "DHL", service: "Express parcel", shipments: 180, paid: 52_600, benchmark: 42_000, causeId: "express" },
      { origin: "Brøndby", destination: "Jutland", carrier: "PostNord", service: "Parcel", shipments: 1480, paid: 61_200, benchmark: 42_600, causeId: "consolidation" },
      { origin: "Brøndby", destination: "Funen", carrier: "DAO", service: "Parcel", shipments: 890, paid: 38_400, benchmark: 25_600, causeId: "consolidation" },
      { origin: "Brøndby", destination: "Sweden", carrier: "PostNord", service: "Parcel", shipments: 240, paid: 41_200, benchmark: 33_000, causeId: "dimensional" },
      { origin: "Brøndby", destination: "Norway", carrier: "Bring", service: "Parcel", shipments: 150, paid: 46_800, benchmark: 42_650, causeId: "fuel" },
      { origin: "Brøndby", destination: "Domestic", carrier: "PostNord", service: "Parcel", shipments: 2100, paid: 86_400, benchmark: 80_000, causeId: "contract" },
      { origin: "Brøndby", destination: "EU", carrier: "Three carriers", service: "Parcel", shipments: 340, paid: 43_750, benchmark: 41_150, causeId: "split" },
    ],
  },
  {
    id: "kolding-table-co",
    name: "Kolding Table Co.",
    industry: "Ecommerce",
    place: "Kolding",
    description:
      "Kitchenware shop. The cartons are light on the scale and large on the tape measure.",
    explanations: {
      express:
        "Replacements for damaged deliveries defaulted to express, including lanes where the shop promises two to four days. A standard service meets that promise.",
      consolidation:
        "Small top-up orders to Zealand and northern Jutland left alone instead of joining the main departure that same day.",
      dimensional:
        "Bowls, pans, and glass travel in cartons that weigh little and measure a lot. Carriers price that as dimensional weight: the carton, not the kilos. It is the largest gap for the shop.",
      fuel:
        "Norway groupage and Bornholm parcels include fuel and ferry add-ons the contract does not allow at the billed level.",
      contract:
        "A domestic pallet rate with Danske Fragtmænd is on file. This month's pallet invoices did not use it.",
      split:
        "Benelux orders are divided across three carriers. The same postcodes would price lower with one carrier taking the lane.",
    },
    months: [
      { paid: 812_400, benchmark: 608_200 },
      { paid: 948_600, benchmark: 698_400 },
      { paid: 486_200, benchmark: 382_400 },
      { paid: 452_800, benchmark: 358_600 },
      { paid: 528_400, benchmark: 412_800 },
      { paid: 564_200, benchmark: 436_800 },
      { paid: 598_600, benchmark: 458_200 },
      { paid: 542_800, benchmark: 421_600 },
      { paid: 468_400, benchmark: 368_200 },
      { paid: 586_200, benchmark: 449_800 },
      { paid: 664_800, benchmark: 506_200 },
      { paid: 726_480, benchmark: 548_160 },
    ],
    lanes: [
      { origin: "Kolding", destination: "Copenhagen", carrier: "GLS", service: "Express parcel", shipments: 410, paid: 72_400, benchmark: 50_600, causeId: "express" },
      { origin: "Kolding", destination: "Aarhus", carrier: "DAO", service: "Express parcel", shipments: 260, paid: 48_600, benchmark: 29_200, causeId: "express" },
      { origin: "Kolding", destination: "Zealand", carrier: "PostNord", service: "Parcel", shipments: 1240, paid: 68_200, benchmark: 51_400, causeId: "consolidation" },
      { origin: "Kolding", destination: "Northern Jutland", carrier: "Bring", service: "Parcel", shipments: 680, paid: 41_400, benchmark: 29_600, causeId: "consolidation" },
      { origin: "Kolding", destination: "Germany", carrier: "DHL", service: "Parcel", shipments: 520, paid: 148_600, benchmark: 110_200, causeId: "dimensional" },
      { origin: "Kolding", destination: "Sweden", carrier: "PostNord", service: "Parcel", shipments: 310, paid: 86_400, benchmark: 62_400, causeId: "dimensional" },
      { origin: "Kolding", destination: "Norway", carrier: "DSV", service: "Road groupage", shipments: 36, paid: 72_480, benchmark: 60_080, causeId: "fuel" },
      { origin: "Kolding", destination: "Bornholm", carrier: "GLS", service: "Parcel, ferry fee", shipments: 90, paid: 24_600, benchmark: 18_600, causeId: "fuel" },
      { origin: "Kolding", destination: "Domestic", carrier: "Danske Fragtmænd", service: "Pallet", shipments: 64, paid: 98_600, benchmark: 81_680, causeId: "contract" },
      { origin: "Kolding", destination: "Benelux", carrier: "Three carriers", service: "Parcel", shipments: 220, paid: 65_200, benchmark: 54_400, causeId: "split" },
    ],
  },
  {
    id: "horsens-gearworks",
    name: "Horsens Gearworks",
    industry: "Manufacturing",
    place: "Horsens",
    description:
      "Machine shop sending gears and subassemblies from Horsens to OEM plants in northern Europe.",
    explanations: {
      express:
        "Parts for Stuttgart and Gothenburg went by air. The customers' dates allowed road transport, and a road service was available on both lanes.",
      consolidation:
        "Hamburg, Poznań, and Malmö each received several small pickups in the same week. A planned full truck on the busy days costs less than the sum of those part-loads.",
      dimensional:
        "Crates to Munich and Warsaw were billed on external size. Several of them were built larger than the part inside required.",
      fuel:
        "Waiting time on the Ruhr run and tail-lift fees to Stockholm were charged outside the contract schedule.",
      contract:
        "Domestic pallets to OEM customers move under a signed rate card. A set of invoices still used a higher tariff.",
      split:
        "Four carriers share the Netherlands plants. Splitting the lane keeps every rate at occasional-volume level.",
    },
    months: [
      { paid: 2_214_000, benchmark: 1_868_000 },
      { paid: 1_986_000, benchmark: 1_692_000 },
      { paid: 2_148_000, benchmark: 1_814_000 },
      { paid: 2_092_000, benchmark: 1_776_000 },
      { paid: 2_284_000, benchmark: 1_922_000 },
      { paid: 2_316_000, benchmark: 1_948_000 },
      { paid: 2_268_000, benchmark: 1_906_000 },
      { paid: 2_184_000, benchmark: 1_842_000 },
      { paid: 1_648_000, benchmark: 1_412_000 },
      { paid: 2_076_000, benchmark: 1_754_000 },
      { paid: 2_298_000, benchmark: 1_936_000 },
      { paid: 2_364_800, benchmark: 1_986_500 },
    ],
    lanes: [
      { origin: "Horsens", destination: "Stuttgart", carrier: "DHL", service: "Air freight", shipments: 14, paid: 186_400, benchmark: 134_000, causeId: "express" },
      { origin: "Horsens", destination: "Gothenburg", carrier: "UPS", service: "Air freight", shipments: 9, paid: 112_600, benchmark: 68_600, causeId: "express" },
      { origin: "Horsens", destination: "Hamburg", carrier: "DSV", service: "Part load", shipments: 42, paid: 248_600, benchmark: 200_000, causeId: "consolidation" },
      { origin: "Horsens", destination: "Poznań", carrier: "DSV", service: "Part load", shipments: 36, paid: 214_800, benchmark: 176_600, causeId: "consolidation" },
      { origin: "Horsens", destination: "Malmö", carrier: "Danske Fragtmænd", service: "Part load", shipments: 28, paid: 126_400, benchmark: 100_400, causeId: "consolidation" },
      { origin: "Horsens", destination: "Munich", carrier: "Schenker", service: "Crates", shipments: 22, paid: 312_400, benchmark: 287_600, causeId: "dimensional" },
      { origin: "Horsens", destination: "Warsaw", carrier: "DSV", service: "Crates", shipments: 18, paid: 186_200, benchmark: 169_800, causeId: "dimensional" },
      { origin: "Horsens", destination: "Ruhr plants", carrier: "DSV", service: "Full truck, waiting", shipments: 16, paid: 364_800, benchmark: 328_600, causeId: "fuel" },
      { origin: "Horsens", destination: "Stockholm", carrier: "Schenker", service: "Full truck, tail lift", shipments: 11, paid: 142_600, benchmark: 124_200, causeId: "fuel" },
      { origin: "Horsens", destination: "Domestic OEMs", carrier: "Danske Fragtmænd", service: "Pallet", shipments: 48, paid: 286_400, benchmark: 237_500, causeId: "contract" },
      { origin: "Horsens", destination: "Netherlands", carrier: "Four carriers", service: "Mixed", shipments: 31, paid: 183_600, benchmark: 159_200, causeId: "split" },
    ],
  },
  {
    id: "skive-plate-works",
    name: "Skive Plate Works",
    industry: "Manufacturing",
    place: "Skive",
    description:
      "Steel-plate works with planned weekly trucks and a few breakdown shipments.",
    explanations: {
      express:
        "Three breakdown shipments to Hamburg flew. They were real exceptions, and the air price is still far above the road service that would have met the revised date.",
      consolidation:
        "Aarhus and Odense took several part-loads in one week. Those parts could have waited for the departure that was already planned.",
      dimensional:
        "Bremen crates were priced on the outside measurement. The standard crate for this part family is smaller than the ones that went.",
      fuel:
        "Waiting time at Esbjerg port and tail-lift charges to Aalborg are not in the amounts the contract allows.",
      contract:
        "The weekly full-truck rate into Germany was agreed, then missed on part of this month's invoices.",
      split:
        "Sweden is divided across three carriers, which keeps the lane off a volume rate.",
    },
    months: [
      { paid: 1_584_000, benchmark: 1_452_000 },
      { paid: 1_426_000, benchmark: 1_314_000 },
      { paid: 1_512_000, benchmark: 1_386_000 },
      { paid: 1_498_000, benchmark: 1_374_000 },
      { paid: 1_564_000, benchmark: 1_432_000 },
      { paid: 1_602_000, benchmark: 1_464_000 },
      { paid: 1_628_000, benchmark: 1_486_000 },
      { paid: 1_556_000, benchmark: 1_424_000 },
      { paid: 1_214_000, benchmark: 1_122_000 },
      { paid: 1_486_000, benchmark: 1_362_000 },
      { paid: 1_598_000, benchmark: 1_461_000 },
      { paid: 1_642_300, benchmark: 1_498_750 },
    ],
    lanes: [
      { origin: "Skive", destination: "Hamburg", carrier: "DHL", service: "Air freight", shipments: 3, paid: 48_600, benchmark: 36_200, causeId: "express" },
      { origin: "Skive", destination: "Aarhus", carrier: "DSV", service: "Part load", shipments: 24, paid: 86_400, benchmark: 70_200, causeId: "consolidation" },
      { origin: "Skive", destination: "Odense", carrier: "Danske Fragtmænd", service: "Part load", shipments: 18, paid: 54_200, benchmark: 41_800, causeId: "consolidation" },
      { origin: "Skive", destination: "Bremen", carrier: "Schenker", service: "Crates", shipments: 14, paid: 168_400, benchmark: 150_200, causeId: "dimensional" },
      { origin: "Skive", destination: "Esbjerg port", carrier: "DSV", service: "Full truck, waiting", shipments: 20, paid: 246_800, benchmark: 222_000, causeId: "fuel" },
      { origin: "Skive", destination: "Aalborg", carrier: "Danske Fragtmænd", service: "Tail lift", shipments: 16, paid: 72_400, benchmark: 55_950, causeId: "fuel" },
      { origin: "Skive", destination: "Germany", carrier: "Schenker", service: "Weekly full truck", shipments: 22, paid: 412_600, benchmark: 380_800, causeId: "contract" },
      { origin: "Skive", destination: "Sweden", carrier: "Three carriers", service: "Mixed", shipments: 19, paid: 186_200, benchmark: 174_900, causeId: "split" },
      { origin: "Skive", destination: "Domestic mills", carrier: "Danske Fragtmænd", service: "Pallet", shipments: 40, paid: 366_700, benchmark: 366_700, causeId: null },
    ],
  },
  {
    id: "esbjerg-rig-supply",
    name: "Esbjerg Rig Supply",
    industry: "Manufacturing",
    place: "Esbjerg",
    description:
      "Industrial supplier sending parts and crates from Esbjerg to yards, ports, and Norwegian bases.",
    explanations: {
      express:
        "Small parts to Stavanger went by courier. A scheduled sailing would have met the yard date on these orders.",
      consolidation:
        "Bergen and Aberdeen received separate part-loads that left on the same days. Each city could have been one consignment.",
      dimensional:
        "Crates for the Rotterdam base were billed on footprint. The contents did not need the size that was built.",
      fuel:
        "Waiting time, port fees, and remote-delivery add-ons to Norwegian bases and the Danish west coast run above the contract.",
      contract:
        "Shipments to the contract yards were covered by the weekly rate. A group of invoices used something else.",
      split:
        "UK deliveries are spread across three carriers, so the lane never builds a primary rate.",
    },
    months: [
      { paid: 812_400, benchmark: 706_200 },
      { paid: 694_800, benchmark: 608_400 },
      { paid: 648_200, benchmark: 572_600 },
      { paid: 702_400, benchmark: 614_800 },
      { paid: 846_200, benchmark: 732_400 },
      { paid: 912_600, benchmark: 786_200 },
      { paid: 968_400, benchmark: 831_600 },
      { paid: 884_200, benchmark: 764_800 },
      { paid: 742_600, benchmark: 648_200 },
      { paid: 806_400, benchmark: 698_600 },
      { paid: 864_800, benchmark: 748_200 },
      { paid: 892_640, benchmark: 771_180 },
    ],
    lanes: [
      { origin: "Esbjerg", destination: "Stavanger", carrier: "DHL", service: "Courier", shipments: 22, paid: 68_400, benchmark: 49_800, causeId: "express" },
      { origin: "Esbjerg", destination: "Bergen", carrier: "DSV", service: "Part load", shipments: 16, paid: 72_400, benchmark: 59_600, causeId: "consolidation" },
      { origin: "Esbjerg", destination: "Aberdeen", carrier: "DSV", service: "Part load", shipments: 12, paid: 58_600, benchmark: 49_000, causeId: "consolidation" },
      { origin: "Esbjerg", destination: "Rotterdam", carrier: "Schenker", service: "Crates", shipments: 8, paid: 64_200, benchmark: 54_400, causeId: "dimensional" },
      { origin: "Esbjerg", destination: "Norwegian bases", carrier: "Bring", service: "Remote delivery", shipments: 18, paid: 186_400, benchmark: 158_000, causeId: "fuel" },
      { origin: "Esbjerg", destination: "Danish west coast", carrier: "Danske Fragtmænd", service: "Port fees", shipments: 14, paid: 62_400, benchmark: 49_540, causeId: "fuel" },
      { origin: "Esbjerg", destination: "Contract yards", carrier: "DSV", service: "Weekly", shipments: 20, paid: 164_800, benchmark: 145_000, causeId: "contract" },
      { origin: "Esbjerg", destination: "United Kingdom", carrier: "Three carriers", service: "Mixed", shipments: 11, paid: 86_440, benchmark: 76_840, causeId: "split" },
      { origin: "Esbjerg", destination: "Domestic", carrier: "Danske Fragtmænd", service: "Pallet", shipments: 26, paid: 129_000, benchmark: 129_000, causeId: null },
    ],
  },
];

const SPEND_PACE = [
  [0.19, 0.41, 0.62, 0.83, 1],
  [0.24, 0.48, 0.69, 0.87, 1],
  [0.16, 0.37, 0.59, 0.8, 1],
] as const;

const BUDGET_PACE = [0.2, 0.4, 0.6, 0.8, 1] as const;

export type MonthTrackPoint = {
  label: string;
  spent: number;
  budget: number;
};

export function currentMonthTrack(customer: Customer): {
  spent: number;
  budget: number;
  points: MonthTrackPoint[];
} {
  const latest = latestFromLanes(customer);
  const budget = Math.round(latest.benchmark / 1000) * 1000;
  let paceIndex = 0;
  for (const char of customer.id) paceIndex = (paceIndex + char.charCodeAt(0)) % SPEND_PACE.length;
  const spendPace = SPEND_PACE[paceIndex];
  const labels = ["Week 1", "Week 2", "Week 3", "Week 4", "Month end"];
  const spent = paceTotals(latest.paid, spendPace);
  const planned = paceTotals(budget, BUDGET_PACE);
  return {
    spent: latest.paid,
    budget,
    points: labels.map((label, index) => ({
      label,
      spent: spent[index],
      budget: planned[index],
    })),
  };
}

function paceTotals(total: number, shares: readonly number[]): number[] {
  const values = shares.map((share, index) =>
    index === shares.length - 1 ? total : Math.round(total * share),
  );
  for (let index = 1; index < values.length; index += 1) {
    if (values[index] < values[index - 1]) values[index] = values[index - 1];
  }
  values[values.length - 1] = total;
  return values;
}

export function latestFromLanes(customer: Customer): {
  paid: number;
  benchmark: number;
  savings: number;
} {
  const paid = customer.lanes.reduce((sum, lane) => sum + lane.paid, 0);
  const benchmark = customer.lanes.reduce((sum, lane) => sum + lane.benchmark, 0);
  return { paid, benchmark, savings: paid - benchmark };
}

export function savingsByCause(customer: Customer): {
  id: CauseId;
  title: string;
  short: string;
  amount: number;
  explanation: string;
}[] {
  return CAUSES.map((cause) => ({
    id: cause.id,
    title: cause.title,
    short: cause.short,
    explanation: customer.explanations[cause.id],
    amount: customer.lanes
      .filter((lane) => lane.causeId === cause.id)
      .reduce((sum, lane) => sum + (lane.paid - lane.benchmark), 0),
  }))
    .filter((cause) => cause.amount > 0)
    .sort((a, b) => b.amount - a.amount);
}

export function causeLabel(id: CauseId | null): string {
  if (id === null) {
    return "At the agreed rate";
  }
  const cause = CAUSES.find((item) => item.id === id);
  return cause ? cause.short : "Unassigned";
}

export function portfolioTotals(): { paid: number; benchmark: number; savings: number } {
  return customers.reduce(
    (totals, customer) => {
      const latest = latestFromLanes(customer);
      return {
        paid: totals.paid + latest.paid,
        benchmark: totals.benchmark + latest.benchmark,
        savings: totals.savings + latest.savings,
      };
    },
    { paid: 0, benchmark: 0, savings: 0 },
  );
}

function assertPortfolio(list: Customer[]): void {
  if (list.length < 4) {
    throw new Error("Expected several companies");
  }
  const ids = new Set<string>();
  let heroes = 0;
  let ecommerce = 0;
  let manufacturing = 0;
  const causeIds: CauseId[] = [
    "express",
    "consolidation",
    "dimensional",
    "fuel",
    "contract",
    "split",
  ];
  if (CAUSES.length !== causeIds.length || new Set(CAUSES.map((cause) => cause.id)).size !== causeIds.length) {
    throw new Error("Cause list is incomplete");
  }

  for (const customer of list) {
    if (ids.has(customer.id)) {
      throw new Error(`Duplicate id ${customer.id}`);
    }
    ids.add(customer.id);
    if (customer.industry === "Ecommerce") ecommerce += 1;
    if (customer.industry === "Manufacturing") manufacturing += 1;
    if (customer.months.length !== MONTHS.length) {
      throw new Error(`${customer.name} does not have 12 months`);
    }
    const latest = latestFromLanes(customer);
    const last = customer.months[customer.months.length - 1];
    if (last.paid !== latest.paid || last.benchmark !== latest.benchmark) {
      throw new Error(
        `${customer.name} latest month ${last.paid}/${last.benchmark} does not match lanes ${latest.paid}/${latest.benchmark}`,
      );
    }
    for (const [index, month] of customer.months.entries()) {
      if (month.paid <= 0 || month.benchmark <= 0 || month.benchmark > month.paid) {
        throw new Error(`${customer.name} month ${index} is implausible`);
      }
    }
    for (const lane of customer.lanes) {
      if (lane.shipments <= 0 || lane.paid <= 0 || lane.benchmark < 0 || lane.benchmark > lane.paid) {
        throw new Error(`${customer.name} lane ${lane.origin} to ${lane.destination} is implausible`);
      }
    }
    let causeSum = 0;
    for (const causeId of causeIds) {
      const amount = customer.lanes
        .filter((lane) => lane.causeId === causeId)
        .reduce((sum, lane) => sum + (lane.paid - lane.benchmark), 0);
      if (amount <= 0) {
        throw new Error(`${customer.name} has no savings for ${causeId}`);
      }
      if (!customer.explanations[causeId] || customer.explanations[causeId].trim().length < 40) {
        throw new Error(`${customer.name} explanation for ${causeId} is missing`);
      }
      causeSum += amount;
    }
    if (causeSum !== latest.savings) {
      throw new Error(`${customer.name} cause sum ${causeSum} does not match savings ${latest.savings}`);
    }
    if (
      latest.paid >= 950_000 &&
      latest.paid <= 1_050_000 &&
      latest.savings >= 180_000 &&
      latest.savings <= 220_000
    ) {
      heroes += 1;
    }
  }
  if (heroes !== 1) {
    throw new Error(`Expected one buyer near 1.000.000 kr. with about 200.000 kr. of savings, found ${heroes}`);
  }
  if (ecommerce < 2 || manufacturing < 2) {
    throw new Error("Expected both ecommerce and manufacturing companies");
  }
}

assertPortfolio(customers);
