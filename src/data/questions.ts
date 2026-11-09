import { carrierProfile } from "./carriers.ts";
import { latestFromLanes } from "./portfolio.ts";
import type { CauseId, Customer, Lane } from "../types.ts";

const AGREEMENT_CAUSES = new Set<CauseId>(["contract", "fuel"]);

export type AgreementLine = {
  id: string;
  carrier: string;
  route: string;
  service: string;
  invoiced: number;
  agreed: number;
  difference: number;
};

export type CarrierFit = {
  name: string;
  shipments: number;
  paid: number;
  gap: number;
  agreementGap: number;
  shape: string | null;
};

export type AccountAnswers = {
  agreementImpact: number;
  agreementLines: AgreementLine[];
  fairPrice: number;
  ratesAboveFair: number;
  carriers: CarrierFit[];
  splitRoutes: string[];
};

export function accountAnswers(customer: Customer): AccountAnswers {
  const latest = latestFromLanes(customer);
  const agreementLines = customer.lanes
    .filter((lane) => lane.causeId !== null && AGREEMENT_CAUSES.has(lane.causeId))
    .map(toAgreementLine)
    .sort((a, b) => b.difference - a.difference);
  const agreementImpact = agreementLines.reduce((sum, line) => sum + line.difference, 0);
  const byCarrier = new Map<string, CarrierFit>();
  const splitRoutes: string[] = [];

  for (const lane of customer.lanes) {
    if (!isNamedCarrier(lane.carrier)) {
      splitRoutes.push(`${lane.origin} to ${lane.destination}`);
      continue;
    }
    const current = byCarrier.get(lane.carrier) ?? {
      name: lane.carrier,
      shipments: 0,
      paid: 0,
      gap: 0,
      agreementGap: 0,
      shape: carrierProfile(lane.carrier)?.shape ?? null,
    };
    current.shipments += lane.shipments;
    current.paid += lane.paid;
    current.gap += lane.paid - lane.benchmark;
    if (lane.causeId !== null && AGREEMENT_CAUSES.has(lane.causeId)) {
      current.agreementGap += lane.paid - lane.benchmark;
    }
    byCarrier.set(lane.carrier, current);
  }

  return {
    agreementImpact,
    agreementLines,
    fairPrice: latest.benchmark,
    ratesAboveFair: latest.savings - agreementImpact,
    carriers: [...byCarrier.values()].sort((a, b) => b.shipments - a.shipments),
    splitRoutes,
  };
}

function toAgreementLine(lane: Lane): AgreementLine {
  return {
    id: `${lane.carrier}-${lane.origin}-${lane.destination}`,
    carrier: lane.carrier,
    route: `${lane.origin} to ${lane.destination}`,
    service: lane.service,
    invoiced: lane.paid,
    agreed: lane.benchmark,
    difference: lane.paid - lane.benchmark,
  };
}

function isNamedCarrier(name: string): boolean {
  return !/carriers/i.test(name);
}
