type Figure = {
  label: string;
  value: string;
  hint: string;
  emphasis?: boolean;
};

export function Figures({ kicker, items }: { kicker: string; items: Figure[] }) {
  return (
    <section className="figures" aria-label={kicker}>
      <p className="kicker">{kicker}</p>
      <div className="figures-grid">
        {items.map((item) => (
          <article key={item.label}>
            <p className="figure-label">{item.label}</p>
            <p className={item.emphasis ? "amount is-savings" : "amount"}>{item.value}</p>
            <p className="hint">{item.hint}</p>
          </article>
        ))}
      </div>
    </section>
  );
}
