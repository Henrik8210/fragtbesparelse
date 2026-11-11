import { useEffect, useState, type FormEvent } from "react";
import { api } from "../api.ts";
import { useLanguage } from "../language.tsx";
import { GateView, useCustomerGate } from "./gate.tsx";
import { NotFound } from "./NotFound.tsx";

type TenderLine = {
  id: string;
  origin: string;
  destination: string;
  service: string;
  carrier: string;
  shipments: number;
  added: boolean;
  excluded: boolean;
};

type TenderComment = { id: string; body: string; name: string };

type Tender = {
  id: string;
  title: string;
  service: string;
  exclusions: string;
  expectations: string;
  lines: TenderLine[];
  comments: TenderComment[];
};

export function TenderPage() {
  const gate = useCustomerGate();
  const { t } = useLanguage();
  if (gate.status === "loading") return null;
  if (gate.status === "missing") return <NotFound title={t("notFound.noCompany")} body={t("notFound.noCompanyBody")} />;
  if (gate.status !== "ok") {
    return (
      <div className="page">
        <GateView gate={gate} />
      </div>
    );
  }
  return <TenderDetail customerId={gate.customer.id} name={gate.customer.name} />;
}

function TenderDetail({ customerId, name }: { customerId: string; name: string }) {
  const { t } = useLanguage();
  const [tender, setTender] = useState<Tender | null>(null);
  const [ready, setReady] = useState(false);
  const [notice, setNotice] = useState("");

  useEffect(() => {
    let cancel = false;
    api<{ tenders: { id: string }[] }>(`/api/companies/${customerId}/tenders`).then(async (result) => {
      const first = result.tenders[0];
      if (!first) {
        if (!cancel) setReady(true);
        return;
      }
      const detail = await api<{ tender: Tender }>(`/api/tenders/${first.id}`);
      if (!cancel) {
        setTender(detail.tender);
        setReady(true);
      }
    });
    return () => {
      cancel = true;
    };
  }, [customerId]);

  async function start() {
    const result = await api<{ tender: Tender }>(`/api/companies/${customerId}/tenders`, { method: "POST" });
    setTender(result.tender);
  }

  async function saveExpectations(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!tender) return;
    const data = new FormData(event.currentTarget);
    const result = await api<{ tender: Tender }>(`/api/tenders/${tender.id}`, {
      method: "PATCH",
      body: JSON.stringify({
        service: String(data.get("service") ?? ""),
        exclusions: String(data.get("exclusions") ?? ""),
        expectations: String(data.get("expectations") ?? ""),
      }),
    });
    setTender(result.tender);
    setNotice(t("tender.saved"));
  }

  async function toggle(line: TenderLine) {
    if (!tender) return;
    const result = await api<{ tender: Tender }>(`/api/tender-lines/${line.id}`, {
      method: "PATCH",
      body: JSON.stringify({ excluded: !line.excluded }),
    });
    setTender(result.tender);
  }

  async function addLine(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!tender) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    const result = await api<{ tender: Tender }>(`/api/tenders/${tender.id}/lines`, {
      method: "POST",
      body: JSON.stringify({
        origin: String(data.get("origin") ?? ""),
        destination: String(data.get("destination") ?? ""),
        service: String(data.get("service") ?? ""),
        carrier: String(data.get("carrier") ?? ""),
        shipments: Number(data.get("shipments") ?? 0),
      }),
    });
    setTender(result.tender);
    form.reset();
  }

  async function comment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!tender) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    const result = await api<{ tender: Tender }>(`/api/tenders/${tender.id}/comments`, {
      method: "POST",
      body: JSON.stringify({ body: String(data.get("body") ?? "") }),
    });
    setTender(result.tender);
    form.reset();
  }

  if (!ready) return null;

  return (
    <div className="page">
      <h1>{t("tender.title")}</h1>
      <p className="meta">{name}</p>
      <p className="section-intro">{t("tender.lead")}</p>
      {!tender ? (
        <button type="button" className="bill-choice" onClick={() => void start()}>
          {t("tender.start")}
        </button>
      ) : (
        <>
          <form className="bill-form" onSubmit={(event) => void saveExpectations(event)}>
            <label className="bill-field">
              <span>{t("tender.service")}</span>
              <input name="service" defaultValue={tender.service} maxLength={500} />
            </label>
            <label className="bill-field">
              <span>{t("tender.exclusions")}</span>
              <input name="exclusions" defaultValue={tender.exclusions} maxLength={500} />
            </label>
            <label className="bill-field">
              <span>{t("tender.expectations")}</span>
              <textarea name="expectations" defaultValue={tender.expectations} maxLength={1000} rows={3} />
            </label>
            <button type="submit" className="bill-choice">
              {t("tender.save")}
            </button>
            {notice ? <p className="hint">{notice}</p> : null}
          </form>
          <ul className="seat-list">
            {tender.lines.map((line) => (
              <li key={line.id} className={line.excluded ? "is-excluded" : undefined}>
                <span>
                  <span className="seat-role">
                    {line.origin} → {line.destination}
                  </span>
                  <span className="seat-person-role">
                    {line.carrier} · {line.service} · {line.shipments}
                    {line.added ? ` · ${t("tender.added")}` : ""}
                  </span>
                </span>
                <button type="button" className="bill-remove" onClick={() => void toggle(line)}>
                  {line.excluded ? t("tender.include") : t("tender.exclude")}
                </button>
              </li>
            ))}
          </ul>
          <form className="bill-form" onSubmit={(event) => void addLine(event)}>
            <h2>{t("tender.add")}</h2>
            <label className="bill-field">
              <span>{t("tender.origin")}</span>
              <input name="origin" required maxLength={80} />
            </label>
            <label className="bill-field">
              <span>{t("tender.destination")}</span>
              <input name="destination" required maxLength={80} />
            </label>
            <label className="bill-field">
              <span>{t("common.service")}</span>
              <input name="service" required maxLength={80} />
            </label>
            <label className="bill-field">
              <span>{t("common.carrier")}</span>
              <input name="carrier" required maxLength={80} />
            </label>
            <label className="bill-field">
              <span>{t("tender.shipments")}</span>
              <input name="shipments" type="number" min={1} required defaultValue={1} />
            </label>
            <button type="submit" className="bill-choice">
              {t("tender.add")}
            </button>
          </form>
          <section className="block">
            <h2>{t("tender.comments")}</h2>
            <ul>
              {tender.comments.map((item) => (
                <li key={item.id}>
                  <strong>{item.name}.</strong> {item.body}
                </li>
              ))}
            </ul>
            <form className="bill-form" onSubmit={(event) => void comment(event)}>
              <label className="bill-field">
                <span>{t("tender.comment")}</span>
                <input name="body" required maxLength={500} />
              </label>
              <button type="submit" className="bill-choice">
                {t("tender.commentSubmit")}
              </button>
            </form>
          </section>
        </>
      )}
    </div>
  );
}
