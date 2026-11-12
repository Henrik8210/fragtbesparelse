import { importRows, parseCsv, suggestMapping } from "./csv.ts";
import { runAudit, type AuditReport } from "./freight.ts";

const ORG_KEY = "fragtblik-pilot-org";

export type Org = {
  id: string;
  name: string;
  carrier: string;
  invoice: string;
  rates: string;
};

const rates = (rows: string) => `service;maks_kg;grundpris_dkk;braendstof_pct;fast_tillaeg_dkk;gyldig_fra;gyldig_til
${rows}`;

const invoice = (rows: string) => `forsendelse;dato;service;vaegt_kg;beloeb_dkk;fra_land;til_land
${rows}`;

export const ORGS: Org[] = [
  {
    id: "nordhavn-living",
    name: "Nordhavn Living",
    carrier: "GLS",
    invoice: invoice(`NL-1001;2026-10-02;Pakkeshop;1,2;67,60;DK;DK
NL-1002;2026-10-03;Pakkeshop;1,8;35,20;DK;DK
NL-1003;2026-10-04;Hjemmelevering;1,5;78,70;DK;DK
NL-1004;2026-10-06;Pakkeshop;3,4;85,20;DK;DK
NL-1005;2026-10-08;Hjemmelevering;4,2;63,80;DK;DK
NL-1006;2026-10-11;Pakkeshop;6,5;92,60;DK;DK
NL-1007;2026-10-14;Hjemmelevering;3,1;112,00;DK;DK
NL-1008;2026-10-18;Erhverv;1,7;48,00;DK;DK`),
    rates: rates(`Pakkeshop;2;32,00;10;0,00;2026-10-01;2026-12-31
Pakkeshop;5;40,00;10;0,00;2026-10-01;2026-12-31
Pakkeshop;10;51,00;10;0,00;2026-10-01;2026-12-31
Hjemmelevering;2;46,00;10;0,00;2026-10-01;2026-12-31
Hjemmelevering;5;58,00;10;0,00;2026-10-01;2026-12-31
Hjemmelevering;10;71,00;10;0,00;2026-10-01;2026-12-31`),
  },
  {
    id: "vesterbro-cloth",
    name: "Vesterbro Cloth",
    carrier: "PostNord",
    invoice: invoice(`VC-2001;2026-10-02;Pakkeshop;0,8;30,40;DK;DK
VC-2002;2026-10-03;Pakkeshop;1,4;24,20;DK;DK
VC-2003;2026-10-05;Hjemmelevering;1,1;40,30;DK;DK
VC-2004;2026-10-07;Pakkeshop;2,4;30,80;DK;DK
VC-2005;2026-10-09;Hjemmelevering;3,6;42,90;DK;DK
VC-2006;2026-10-12;Pakkeshop;5,5;39,60;DK;DK`),
    rates: rates(`Pakkeshop;2;22,00;10;0,00;2026-10-01;2026-12-31
Pakkeshop;5;28,00;10;0,00;2026-10-01;2026-12-31
Pakkeshop;10;36,00;10;0,00;2026-10-01;2026-12-31
Hjemmelevering;2;31,00;10;0,00;2026-10-01;2026-12-31
Hjemmelevering;5;39,00;10;0,00;2026-10-01;2026-12-31
Hjemmelevering;10;48,00;10;0,00;2026-10-01;2026-12-31`),
  },
  {
    id: "kolding-table-co",
    name: "Kolding Table Co.",
    carrier: "GLS",
    invoice: invoice(`KT-3001;2026-10-02;Pakkeshop;1,3;62,50;DK;DK
KT-3002;2026-10-04;Hjemmelevering;1,9;80,10;DK;DK
KT-3003;2026-10-06;Pakkeshop;4,1;72,40;DK;DK
KT-3004;2026-10-08;Hjemmelevering;4,8;70,40;DK;DK
KT-3005;2026-10-11;Pakkeshop;6,8;61,60;DK;DK
KT-3006;2026-10-13;Hjemmelevering;8,2;86,90;DK;DK
KT-3007;2026-10-16;Erhverv;3,0;62,00;DK;DK`),
    rates: rates(`Pakkeshop;2;35,00;10;0,00;2026-10-01;2026-12-31
Pakkeshop;5;44,00;10;0,00;2026-10-01;2026-12-31
Pakkeshop;10;56,00;10;0,00;2026-10-01;2026-12-31
Hjemmelevering;2;50,00;10;0,00;2026-10-01;2026-12-31
Hjemmelevering;5;64,00;10;0,00;2026-10-01;2026-12-31
Hjemmelevering;10;79,00;10;0,00;2026-10-01;2026-12-31`),
  },
  {
    id: "horsens-gearworks",
    name: "Horsens Gearworks",
    carrier: "Danske Fragtmænd",
    invoice: invoice(`HW-4001;2026-10-01;Pakkeshop;1,9;116,80;DK;DK
HW-4002;2026-10-03;Hjemmelevering;1,6;128,80;DK;DK
HW-4003;2026-10-05;Pakkeshop;4,4;138,90;DK;DK
HW-4004;2026-10-07;Hjemmelevering;3,8;114,40;DK;DK
HW-4005;2026-10-09;Pakkeshop;7,2;123,20;DK;DK
HW-4006;2026-10-12;Hjemmelevering;8,8;140,80;DK;DK
HW-4007;2026-10-15;Pakkeshop;2,8;97,90;DK;DK
HW-4008;2026-10-18;Hjemmelevering;6,1;140,80;DK;DK
HW-4009;2026-10-21;Erhverv;5,0;99,00;DK;DK`),
    rates: rates(`Pakkeshop;2;68,00;10;0,00;2026-10-01;2026-12-31
Pakkeshop;5;89,00;10;0,00;2026-10-01;2026-12-31
Pakkeshop;10;112,00;10;0,00;2026-10-01;2026-12-31
Hjemmelevering;2;82,00;10;0,00;2026-10-01;2026-12-31
Hjemmelevering;5;104,00;10;0,00;2026-10-01;2026-12-31
Hjemmelevering;10;128,00;10;0,00;2026-10-01;2026-12-31`),
  },
  {
    id: "skive-plate-works",
    name: "Skive Plate Works",
    carrier: "Danske Fragtmænd",
    invoice: invoice(`SP-5001;2026-10-03;Pakkeshop;1,1;51,90;DK;DK
SP-5002;2026-10-06;Hjemmelevering;1,7;53,90;DK;DK
SP-5003;2026-10-09;Pakkeshop;3,3;58,30;DK;DK
SP-5004;2026-10-13;Hjemmelevering;4,6;68,20;DK;DK
SP-5005;2026-10-17;Pakkeshop;6,4;73,70;DK;DK`),
    rates: rates(`Pakkeshop;2;41,00;10;0,00;2026-10-01;2026-12-31
Pakkeshop;5;53,00;10;0,00;2026-10-01;2026-12-31
Pakkeshop;10;67,00;10;0,00;2026-10-01;2026-12-31
Hjemmelevering;2;49,00;10;0,00;2026-10-01;2026-12-31
Hjemmelevering;5;62,00;10;0,00;2026-10-01;2026-12-31
Hjemmelevering;10;76,00;10;0,00;2026-10-01;2026-12-31`),
  },
  {
    id: "esbjerg-rig-supply",
    name: "Esbjerg Rig Supply",
    carrier: "DSV",
    invoice: invoice(`ER-6001;2026-10-02;Pakkeshop;1,5;75,40;DK;DK
ER-6002;2026-10-04;Hjemmelevering;1,8;83,20;DK;DK
ER-6003;2026-10-07;Pakkeshop;3,9;77,00;DK;DK
ER-6004;2026-10-09;Hjemmelevering;4,1;89,10;DK;DK
ER-6005;2026-10-12;Pakkeshop;6,6;96,80;DK;DK
ER-6006;2026-10-15;Hjemmelevering;7,4;108,90;DK;DK
ER-6007;2026-10-18;Pakkeshop;2,2;59,40;DK;DK
ER-6008;2026-10-20;Erhverv;4,5;71,00;DK;DK`),
    rates: rates(`Pakkeshop;2;54,00;10;0,00;2026-10-01;2026-12-31
Pakkeshop;5;70,00;10;0,00;2026-10-01;2026-12-31
Pakkeshop;10;88,00;10;0,00;2026-10-01;2026-12-31
Hjemmelevering;2;63,00;10;0,00;2026-10-01;2026-12-31
Hjemmelevering;5;81,00;10;0,00;2026-10-01;2026-12-31
Hjemmelevering;10;99,00;10;0,00;2026-10-01;2026-12-31`),
  },
];

export const SAMPLE_COVERAGE: Record<string, { peers: number; groups: number[] }> = {
  "nordhavn-living": { peers: 5, groups: [5, 4, 4, 5, 4, 3, 4, 3, 2] },
  "vesterbro-cloth": { peers: 4, groups: [4, 3, 2, 4, 3, 1, 2, 1, 0] },
  "kolding-table-co": { peers: 3, groups: [3, 3, 2, 2, 3, 3, 3, 2, 1] },
  "horsens-gearworks": { peers: 2, groups: [1, 2, 2, 1, 2, 2, 2, 2, 1] },
  "skive-plate-works": { peers: 1, groups: [1, 1, 0, 1, 1, 0, 0, 1, 1] },
  "esbjerg-rig-supply": { peers: 4, groups: [2, 4, 1, 3, 4, 4, 1, 2, 3] },
};

export function peerCount(orgId: string) {
  return SAMPLE_COVERAGE[orgId]?.peers ?? 0;
}

export function carrierPeers(orgId: string, index: number) {
  return SAMPLE_COVERAGE[orgId]?.groups[index] ?? 0;
}

export function orgById(id: string): Org {
  return ORGS.find((org) => org.id === id) ?? ORGS[0];
}

export function loadOrgId(): string {
  try {
    const id = localStorage.getItem(ORG_KEY);
    return id && ORGS.some((org) => org.id === id) ? id : ORGS[0].id;
  } catch {
    return ORGS[0].id;
  }
}

export function saveOrgId(id: string) {
  localStorage.setItem(ORG_KEY, id);
}

export function orgAudit(org: Org): AuditReport {
  const invoiceSheet = parseCsv(org.invoice);
  const rateSheet = parseCsv(org.rates);
  return runAudit(
    importRows("invoice", invoiceSheet, suggestMapping("invoice", invoiceSheet.headers)),
    importRows("rates", rateSheet, suggestMapping("rates", rateSheet.headers)),
  );
}
