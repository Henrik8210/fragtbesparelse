// Danish wording for sample copy that lives in English in portfolio.ts and carriers.ts.
// English mode shows the source string. A missing key falls back to English.

const phrases: Record<string, string> = {
  "month.2025-11": "november 2025",
  "month.2025-12": "december 2025",
  "month.2026-01": "januar 2026",
  "month.2026-02": "februar 2026",
  "month.2026-03": "marts 2026",
  "month.2026-04": "april 2026",
  "month.2026-05": "maj 2026",
  "month.2026-06": "juni 2026",
  "month.2026-07": "juli 2026",
  "month.2026-08": "august 2026",
  "month.2026-09": "september 2026",
  "month.2026-10": "oktober 2026",
  "monthShort.2025-11": "nov",
  "monthShort.2025-12": "dec",
  "monthShort.2026-01": "jan",
  "monthShort.2026-02": "feb",
  "monthShort.2026-03": "mar",
  "monthShort.2026-04": "apr",
  "monthShort.2026-05": "maj",
  "monthShort.2026-06": "jun",
  "monthShort.2026-07": "jul",
  "monthShort.2026-08": "aug",
  "monthShort.2026-09": "sep",
  "monthShort.2026-10": "okt",
  "week.Week 1": "Uge 1",
  "week.Week 2": "Uge 2",
  "week.Week 3": "Uge 3",
  "week.Week 4": "Uge 4",
  "week.Month end": "Månedens slutning",

  "service.Express parcel": "Ekspresparcel",
  "service.Express Saver": "Express Saver",
  "service.Parcel": "Pakke",
  "service.Road groupage": "Stykgods på vej",
  "service.Parcel, island fee": "Pakke, ø-tillæg",
  "service.Pallet": "Palle",
  "service.Parcel, ferry fee": "Pakke, færgetillæg",
  "service.Air freight": "Luftfragt",
  "service.Part load": "Dellast",
  "service.Crates": "Kasser",
  "service.Full truck, waiting": "Helt læs, ventetid",
  "service.Full truck, tail lift": "Helt læs, lift",
  "service.Mixed": "Blandet",
  "service.Tail lift": "Bagsmækslift",
  "service.Weekly full truck": "Ugentligt helt læs",
  "service.Courier": "Kurer",
  "service.Remote delivery": "Levering i yderområde",
  "service.Port fees": "Havnegebyrer",
  "service.Weekly": "Ugentlig",

  "place.Copenhagen": "København",
  "place.Danish islands": "Danske øer",
  "place.Domestic B2B": "Indenlandsk erhverv",
  "place.Netherlands": "Nederlandene",
  "place.Germany": "Tyskland",
  "place.Jutland": "Jylland",
  "place.Funen": "Fyn",
  "place.Sweden": "Sverige",
  "place.Norway": "Norge",
  "place.Domestic": "Indenlandsk",
  "place.Zealand": "Sjælland",
  "place.Northern Jutland": "Nordjylland",
  "place.Ruhr plants": "Fabrikker i Ruhr",
  "place.Domestic OEMs": "Indenlandske OEM-kunder",
  "place.Esbjerg port": "Esbjerg Havn",
  "place.Domestic mills": "Indenlandske værker",
  "place.Norwegian bases": "Norske baser",
  "place.Danish west coast": "Den danske vestkyst",
  "place.Contract yards": "Aftaleværfter",
  "place.United Kingdom": "Storbritannien",

  "carrier.Four carriers": "Fire fragtfirmaer",
  "carrier.Three carriers": "Tre fragtfirmaer",

  "shape.GLS": "Pakkefakturaer viser en service og derefter en særskilt linje for et ø- eller færgetillæg.",
  "shape.DHL": "Ekspres- og pakkefakturaer sætter grundpris og tillæg i to kolonner på samme række.",
  "shape.PostNord": "Indenlandske fakturaer viser listepris og kontopris. Den fakturerede kolonne er den pris, der blev brugt.",
  "shape.Danske Fragtmænd": "Pallefakturaer bruger et zonekort. Den aftalte pris er en række på det kort.",
  "shape.DSV": "Vejfakturaer sætter brændstof og ventetid på egne linjer under fragtbeløbet.",
  "shape.Bring": "Pakkefakturaer viser forsendelsesprisen og derefter et yderområdetillæg på næste linje.",
  "shape.DAO": "Pakkefakturaer har ét beløb pr. forsendelse, med servicenavnet i beskrivelsen.",
  "shape.UPS": "Ekspresfakturaer viser en offentlig pris og en rabat. Det fakturerede beløb er prisen efter rabatten.",
  "shape.Schenker": "Vejfakturaer prissætter læsset og lægger bagsmækslift eller kassehåndtering på som ekstra linjer.",

  "desc.nordhavn-living": "Boligbutik der sender pakker og nogle paller fra et lager i Taastrup.",
  "desc.vesterbro-cloth": "Modebutik der sender mange små pakker, også ombytninger, fra et lager i Brøndby.",
  "desc.kolding-table-co": "Køkkenbutik. Kasserne vejer lidt og fylder meget.",
  "desc.horsens-gearworks": "Maskinværksted der sender tandhjul og delmontage fra Horsens til OEM-fabrikker i Nordeuropa.",
  "desc.skive-plate-works": "Stålpladeværk med planlagte ugentlige lastbiler og enkelte hasteforsendelser.",
  "desc.esbjerg-rig-supply": "Industrileverandør der sender dele og kasser fra Esbjerg til værfter, havne og norske baser.",

  "explain.nordhavn-living.express":
    "Pakker til København, Hamborg og Stockholm gik som ekspres. På de spor når en standardservice stadig frem inden for den dato, butikken viser kunden, så ekspresgebyret køber intet, som løftet krævede.",
  "explain.nordhavn-living.consolidation":
    "Ordrer til Aarhus, Odense og Aalborg gik som særskilte pakker i løbet af dagen. Én afgang til hver by ville have betalt for færre afhentninger og færre labels.",
  "explain.nordhavn-living.dimensional":
    "Lamper, tekstiler og fladpakket møbel til Berlin og Malmö blev prissat efter kassens størrelse, langt over vægten på vægten. Fragtfirmaer kalder reglen rumvægt. Tættere emballage på de værste varer lukker det meste af dette gab.",
  "explain.nordhavn-living.fuel":
    "Brændstof og yderområdegebyrer på Rotterdam-stykgodset og ø-leveringerne ligger over beløbene i fragtaftalen.",
  "explain.nordhavn-living.contract":
    "Indenlandske paller med Danske Fragtmænd blev faktureret over det takstkort, der allerede er underskrevet. Forsendelserne er berettiget til den aftalte pris. Fakturaen brugte den ikke.",
  "explain.nordhavn-living.split":
    "Flowet til Nederlandene deles af fire fragtfirmaer. Ingen af dem ser nok af sporet til at prise det som en primær rute.",

  "explain.vesterbro-cloth.express":
    "Ordrer til København og Tyskland gik som ekspres, også når køberen ikke havde betalt for hurtig levering. En økonomiservice holder stadig butikkens angivne vindue på begge spor.",
  "explain.vesterbro-cloth.consolidation":
    "Enkeltvarer og ombytninger til Jylland og Fyn blev sendt som egne pakker. En skæringstid samme dag ville have lagt dem i én sæk pr. by.",
  "explain.vesterbro-cloth.dimensional":
    "Blødt tøj i for store poser til Sverige blev faktureret for den tomme plads i posen. Tøjets vægt satte ikke prisen.",
  "explain.vesterbro-cloth.fuel": "Pakkerne til Norge har et brændstoftillæg over det loft, der står i aftalen.",
  "explain.vesterbro-cloth.contract":
    "En del af den indenlandske PostNord-fakturering brugte den offentlige listepris. Kontoprisen var aktiv den måned. Den var bare ikke prisen på de fakturaer.",
  "explain.vesterbro-cloth.split":
    "Webordrer til EU kører på tre fragtfirmaer, så flowet prises som lejlighedsvolumen og ikke som et fast spor.",

  "explain.kolding-table-co.express":
    "Erstatninger for beskadigede leveringer gik som standard som ekspres, også på spor hvor butikken lover to til fire dage. En standardservice holder det løfte.",
  "explain.kolding-table-co.consolidation":
    "Små efterbestillinger til Sjælland og Nordjylland gik alene i stedet for at følge hovedafgangen samme dag.",
  "explain.kolding-table-co.dimensional":
    "Skåle, pander og glas kører i kasser, der vejer lidt og måler meget. Fragtfirmaer priser det som rumvægt: kassen, ikke kiloene. Det er butikkens største gab.",
  "explain.kolding-table-co.fuel":
    "Stykgods til Norge og pakker til Bornholm har brændstof- og færgetillæg, som aftalen ikke tillader på det fakturerede niveau.",
  "explain.kolding-table-co.contract":
    "En indenlandsk pallepris hos Danske Fragtmænd ligger i sagen. Månedens pallefakturaer brugte den ikke.",
  "explain.kolding-table-co.split":
    "Ordrer til Benelux er delt på tre fragtfirmaer. De samme postnumre ville prise lavere, hvis ét fragtfirma tog sporet.",

  "explain.horsens-gearworks.express":
    "Dele til Stuttgart og Göteborg gik med fly. Kundernes datoer tillod vejtransport, og en vejservice var ledig på begge spor.",
  "explain.horsens-gearworks.consolidation":
    "Hamborg, Poznań og Malmö fik hver flere små afhentninger i samme uge. Et planlagt helt læs på de travle dage koster mindre end summen af de dellæs.",
  "explain.horsens-gearworks.dimensional":
    "Kasser til München og Warszawa blev faktureret efter det udvendige mål. Flere af dem var bygget større, end delen inden i krævede.",
  "explain.horsens-gearworks.fuel":
    "Ventetid på Ruhr-turen og liftgebyrer til Stockholm blev opkrævet uden for aftalens takst.",
  "explain.horsens-gearworks.contract":
    "Indenlandske paller til OEM-kunder kører på et underskrevet takstkort. En gruppe fakturaer brugte stadig en højere takst.",
  "explain.horsens-gearworks.split":
    "Fire fragtfirmaer deler fabrikkerne i Nederlandene. Opdelingen holder hver pris på lejlighedsniveau.",

  "explain.skive-plate-works.express":
    "Tre hasteforsendelser til Hamborg fløj. De var reelle undtagelser, og flyprisen ligger stadig langt over den vejservice, der ville have holdt den reviderede dato.",
  "explain.skive-plate-works.consolidation":
    "Aarhus og Odense fik flere dellæs på én uge. De dele kunne have ventet på den afgang, der allerede var planlagt.",
  "explain.skive-plate-works.dimensional":
    "Kasser til Bremen blev prissat efter det udvendige mål. Standardkassen til denne delefamilie er mindre end dem, der blev sendt.",
  "explain.skive-plate-works.fuel":
    "Ventetid i Esbjerg Havn og liftgebyrer til Aalborg ligger uden for de beløb, aftalen tillader.",
  "explain.skive-plate-works.contract":
    "Den ugentlige pris for helt læs til Tyskland var aftalt og blev så ramt ved siden af på en del af månedens fakturaer.",
  "explain.skive-plate-works.split":
    "Sverige er delt på tre fragtfirmaer, og det holder sporet væk fra en volumenpris.",

  "explain.esbjerg-rig-supply.express":
    "Smådele til Stavanger gik med kurer. En planlagt sejlads ville have holdt værftsdatoen på de ordrer.",
  "explain.esbjerg-rig-supply.consolidation":
    "Bergen og Aberdeen fik særskilte dellæs, der gik samme dage. Hver by kunne have været én forsendelse.",
  "explain.esbjerg-rig-supply.dimensional":
    "Kasser til basen i Rotterdam blev faktureret efter fodaftrykket. Indholdet havde ikke brug for den størrelse, der blev bygget.",
  "explain.esbjerg-rig-supply.fuel":
    "Ventetid, havnegebyrer og tillæg for fjernlevering til norske baser og den danske vestkyst ligger over aftalen.",
  "explain.esbjerg-rig-supply.contract":
    "Forsendelser til aftaleværfterne var dækket af ugeprisen. En gruppe fakturaer brugte noget andet.",
  "explain.esbjerg-rig-supply.split":
    "Leveringer til Storbritannien er spredt på tre fragtfirmaer, så sporet aldrig opbygger en primær pris.",
};

export function danishPhrase(key: string): string | undefined {
  return phrases[key];
}

export function danishPhraseKeys(): string[] {
  return Object.keys(phrases);
}
