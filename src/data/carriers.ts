// One line each on how a sample invoice is laid out. This is not a parser.

export type CarrierProfile = {
  name: string;
  shape: string;
};

export const carrierProfiles: CarrierProfile[] = [
  {
    name: "GLS",
    shape: "Parcel invoices list a service, then a separate line for an island or ferry fee.",
  },
  {
    name: "DHL",
    shape: "Express and parcel invoices put the base rate and the surcharge in two columns on one row.",
  },
  {
    name: "PostNord",
    shape: "Domestic invoices show a list price and an account rate. The billed column is the rate that was applied.",
  },
  {
    name: "Danske Fragtmænd",
    shape: "Pallet invoices use a zone rate card. The agreed price is a row on that card.",
  },
  {
    name: "DSV",
    shape: "Road invoices place fuel and waiting time on their own lines under the freight amount.",
  },
  {
    name: "Bring",
    shape: "Parcel invoices show the shipment price, then a remote-area fee on the next line.",
  },
  {
    name: "DAO",
    shape: "Parcel invoices carry one amount per shipment, with the service name in the description.",
  },
  {
    name: "UPS",
    shape: "Express invoices show a published rate and a discount. The billed amount is the rate after that discount.",
  },
  {
    name: "Schenker",
    shape: "Road invoices price the load, then add tail-lift or crate handling as extra lines.",
  },
];

export function carrierProfile(name: string): CarrierProfile | undefined {
  return carrierProfiles.find((profile) => profile.name === name);
}
