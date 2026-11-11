// Sample index only. Scores use the other fictional companies in portfolio.ts.
// This is not a live market and not a tender.

import { customers } from "./portfolio.ts";
import type { Customer, Lane } from "../types.ts";

type Mode = "parcel" | "freight" | "air";

const PARCEL = new Set(["GLS", "PostNord", "DAO", "Bring"]);
const PARCEL_OR_AIR = new Set(["DHL", "UPS"]);
const FREIGHT = new Set(["DSV", "Danske Fragtmænd", "Schenker"]);

export type CarrierScore = {
  name: string;
  score: number;
  similarCount: number;
  preferCount: number;
  gapKr: number;
  comparable: boolean;
  modelMatch: boolean;
};

export type FitIndex = {
  similarNames: string[];
  scores: CarrierScore[];
  marketGap: number;
};

export function carrierFitIndex(customer: Customer): FitIndex {
  const ownKeys = routeKeys(customer);
  const peers = customers.filter(
    (other) =>
      other.id !== customer.id &&
      other.industry === customer.industry &&
      sharesRoute(routeKeys(other), ownKeys),
  );
  const names = namedCarriers(customer);
  const scores = names
    .map((name) => scoreCarrier(name, customer, peers))
    .sort((a, b) => b.score - a.score || b.similarCount - a.similarCount);

  return {
    similarNames: peers.map((peer) => peer.name),
    scores,
    marketGap: scores.reduce((sum, score) => sum + score.gapKr, 0),
  };
}

function scoreCarrier(name: string, customer: Customer, peers: Customer[]): CarrierScore {
  const lanes = namedLanes(customer).filter((lane) => lane.carrier === name);
  const shipments = lanes.reduce((sum, lane) => sum + lane.shipments, 0);
  const paid = lanes.reduce((sum, lane) => sum + lane.paid, 0);
  const fitting = lanes
    .filter((lane) => modelFits(name, modeOf(lane.service)))
    .reduce((sum, lane) => sum + lane.shipments, 0);
  const modelPoints = shipments === 0 ? 0 : (40 * fitting) / shipments;

  const keys = new Set(lanes.map((lane) => routeKey(lane)));
  const peersHere = peers.filter((peer) => sharesRoute(routeKeys(peer), keys));
  let ownWeighted = 0;
  let peerWeighted = 0;
  let comparedShipments = 0;
  let gapKr = 0;
  let pricePoints = 0;

  for (const lane of lanes) {
    const key = routeKey(lane);
    const peerPaid = peerPaidOn(peersHere, key);
    if (peerPaid.shipments === 0) continue;
    const ownRate = lane.paid / lane.shipments;
    const peerRate = peerPaid.paid / peerPaid.shipments;
    comparedShipments += lane.shipments;
    ownWeighted += ownRate * lane.shipments;
    peerWeighted += peerRate * lane.shipments;
    if (ownRate > peerRate) gapKr += Math.round((ownRate - peerRate) * lane.shipments);
    const ratio = peerRate === 0 ? 0 : (ownRate - peerRate) / peerRate;
    const closeness = Math.min(1, Math.max(0, 1 - ratio / 0.5));
    pricePoints += closeness * lane.shipments;
  }

  const price = comparedShipments === 0 ? 20 : (40 * pricePoints) / comparedShipments;
  const agreementGap = lanes
    .filter((lane) => lane.causeId === "contract" || lane.causeId === "fuel")
    .reduce((sum, lane) => sum + (lane.paid - lane.benchmark), 0);
  const agreement =
    paid === 0 ? 0 : 20 * (1 - Math.min(1, agreementGap / paid / 0.25));
  const preferCount = peersHere.filter((peer) => preferredCarrier(peer, keys) === name).length;

  return {
    name,
    score: clampScore(modelPoints + price + agreement),
    similarCount: peersHere.length,
    preferCount,
    gapKr,
    comparable: comparedShipments > 0,
    modelMatch: shipments > 0 && fitting === shipments,
  };
}

function preferredCarrier(peer: Customer, keys: Set<string>): string | null {
  const totals = new Map<string, number>();
  for (const lane of namedLanes(peer)) {
    if (!keys.has(routeKey(lane))) continue;
    totals.set(lane.carrier, (totals.get(lane.carrier) ?? 0) + lane.shipments);
  }
  let best: string | null = null;
  let bestShipments = 0;
  for (const [name, shipments] of totals) {
    if (shipments > bestShipments) {
      best = name;
      bestShipments = shipments;
    }
  }
  return best;
}

function peerPaidOn(peers: Customer[], key: string): { paid: number; shipments: number } {
  let paid = 0;
  let shipments = 0;
  for (const peer of peers) {
    for (const lane of namedLanes(peer)) {
      if (routeKey(lane) !== key) continue;
      paid += lane.paid;
      shipments += lane.shipments;
    }
  }
  return { paid, shipments };
}

function namedCarriers(customer: Customer): string[] {
  return [...new Set(namedLanes(customer).map((lane) => lane.carrier))];
}

function namedLanes(customer: Customer): Lane[] {
  return customer.lanes.filter((lane) => !/carriers/i.test(lane.carrier));
}

function routeKeys(customer: Customer): Set<string> {
  return new Set(customer.lanes.map((lane) => routeKey(lane)));
}

function sharesRoute(left: Set<string>, right: Set<string>): boolean {
  for (const key of left) {
    if (right.has(key)) return true;
  }
  return false;
}

function routeKey(lane: Lane): string {
  return `${regionOf(lane.destination)}:${modeOf(lane.service)}`;
}

function modeOf(service: string): Mode {
  const text = service.toLowerCase();
  if (text.includes("air")) return "air";
  if (
    /pallet|part load|full truck|crate|groupage|weekly|tail lift|port fee|waiting|remote/.test(text)
  ) {
    return "freight";
  }
  return "parcel";
}

function modelFits(carrier: string, mode: Mode): boolean {
  if (mode === "parcel") return PARCEL.has(carrier) || PARCEL_OR_AIR.has(carrier);
  if (mode === "air") return PARCEL_OR_AIR.has(carrier);
  return FREIGHT.has(carrier);
}

function regionOf(destination: string): string {
  const text = destination.toLowerCase();
  if (/copenhagen|zealand|domestic|jutland|funen|odense|aarhus|aalborg|bornholm|island|west coast|mills|oem/.test(text)) {
    return "denmark";
  }
  if (/hamburg|germany|berlin|munich|bremen|ruhr|stuttgart/.test(text)) return "germany";
  if (/sweden|stockholm|gothenburg|malm/.test(text)) return "sweden";
  if (/norway|stavanger|bergen/.test(text)) return "norway";
  if (/netherlands|rotterdam|benelux/.test(text)) return "benelux";
  if (/poland|pozna|warsaw/.test(text)) return "poland";
  if (/united kingdom|aberdeen/.test(text)) return "uk";
  return text;
}

function clampScore(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}
