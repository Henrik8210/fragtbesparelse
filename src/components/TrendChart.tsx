import { formatNumber } from "../format.ts";
import { useLanguage } from "../language.tsx";

type Point = { paid: number; benchmark: number };

function scale(maxValue: number): { max: number; ticks: number[] } {
  const rough = maxValue * 1.08;
  const target = rough / 4;
  const magnitude = 10 ** Math.floor(Math.log10(target));
  const residual = target / magnitude;
  const nice =
    residual <= 1 ? 1 : residual <= 2 ? 2 : residual <= 2.5 ? 2.5 : residual <= 5 ? 5 : 10;
  const step = nice * magnitude;
  const intervals = Math.ceil(rough / step);
  const max = step * intervals;
  return {
    max,
    ticks: Array.from({ length: intervals + 1 }, (_, index) => index * step),
  };
}

export function TrendChart({
  labels,
  points,
  rangeLabel,
}: {
  labels: string[];
  points: Point[];
  rangeLabel: string;
}) {
  const { t } = useLanguage();
  const maxPaid = Math.max(...points.map((point) => point.paid));
  const { max, ticks } = scale(maxPaid);
  const inset = 8;
  const xOf = (index: number) => inset + (index / (points.length - 1)) * (100 - inset * 2);
  const yOf = (value: number) => 100 - (value / max) * 100;
  const line = (key: "paid" | "benchmark") =>
    points.map((point, index) => `${xOf(index)},${yOf(point[key])}`).join(" ");
  const area = [
    ...points.map((point, index) => `${xOf(index)},${yOf(point.paid)}`),
    ...points.map((point, index) => `${xOf(index)},${yOf(point.benchmark)}`).reverse(),
  ].join(" ");

  return (
    <figure className="chart">
      <figcaption className="sr-only">
        {t("chart.trendCaption", { range: rangeLabel })}
      </figcaption>
      <ul className="legend">
        <li>
          <span className="swatch swatch-paid" /> {t("common.paid")}
        </li>
        <li>
          <span className="swatch swatch-benchmark" /> {t("common.benchmark")}
        </li>
        <li>
          <span className="swatch swatch-gap" /> {t("chart.gap")}
        </li>
      </ul>
      <div className="chart-body">
        <div className="y-axis" aria-hidden="true">
          {ticks.map((tick) => (
            <span key={tick} style={{ top: `${yOf(tick)}%` }}>
              {formatNumber(tick)}
            </span>
          ))}
        </div>
        <div className="plot">
          <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
            {ticks.map((tick) => (
              <line
                key={tick}
                x1={inset}
                x2={100 - inset}
                y1={yOf(tick)}
                y2={yOf(tick)}
                className={tick === 0 ? "grid-zero" : "grid-line"}
                vectorEffect="non-scaling-stroke"
              />
            ))}
            <polygon points={area} className="gap-fill" />
            <polyline
              points={line("benchmark")}
              className="line-benchmark"
              vectorEffect="non-scaling-stroke"
              fill="none"
            />
            <polyline
              points={line("paid")}
              className="line-paid"
              vectorEffect="non-scaling-stroke"
              fill="none"
            />
          </svg>
          <div className="x-labels" aria-hidden="true">
            {labels.map((label, index) => (
              <span
                key={label}
                className={index === labels.length - 1 ? "is-latest" : undefined}
                style={{ left: `${xOf(index)}%` }}
              >
                {label}
              </span>
            ))}
          </div>
        </div>
      </div>
    </figure>
  );
}
