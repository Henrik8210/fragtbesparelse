export type CauseId =
  | "express"
  | "consolidation"
  | "dimensional"
  | "fuel"
  | "contract"
  | "split";

export type Industry = "Ecommerce" | "Manufacturing";

export type MonthPoint = {
  paid: number;
  benchmark: number;
};

export type Lane = {
  origin: string;
  destination: string;
  carrier: string;
  service: string;
  shipments: number;
  paid: number;
  benchmark: number;
  causeId: CauseId | null;
};

export type Customer = {
  id: string;
  name: string;
  industry: Industry;
  place: string;
  description: string;
  months: MonthPoint[];
  explanations: Record<CauseId, string>;
  lanes: Lane[];
};
