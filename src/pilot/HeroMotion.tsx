import { useEffect, useRef } from "react";

const LOOP = 10;
const STILL_AT = 8;

const BLUE = "#155c92";
const TEAL = "#39a4a2";
const GREEN = "#16634e";
const MINT = "#a9efd8";
const AMBER = "#9a4b21";

type Lane = { kind: "plane" | "truck" | "ship"; path: string; dur: number; begin: number; reverse?: boolean; scale?: number };

const LANES: Lane[] = [
  { kind: "plane", path: "M-40 78C140 6 380 52 600 18", dur: 10, begin: 0 },
  { kind: "plane", path: "M600 150C450 66 220 120 -40 44", dur: 5, begin: -2 },
  { kind: "plane", path: "M70 440C160 270 380 170 600 -30", dur: 10, begin: -6, scale: 0.8 },
  { kind: "plane", path: "M-40 230C120 170 260 210 600 120", dur: 10, begin: -3.5, scale: 0.7 },
  { kind: "truck", path: "M-40 312C110 288 210 358 330 340S510 292 600 322", dur: 10, begin: 0 },
  { kind: "truck", path: "M-40 312C110 288 210 358 330 340S510 292 600 322", dur: 10, begin: -5, reverse: true },
  { kind: "truck", path: "M480 -20C430 120 560 210 470 420", dur: 5, begin: -1 },
  { kind: "truck", path: "M64 -20C124 120 18 250 92 420", dur: 10, begin: -7, reverse: true },
  { kind: "truck", path: "M64 -20C124 120 18 250 92 420", dur: 10, begin: -2 },
  { kind: "ship", path: "M-80 366H640", dur: 10, begin: -1 },
  { kind: "ship", path: "M-80 386H640", dur: 10, begin: -6, reverse: true, scale: 0.85 },
];

const ROWS = [
  { carrier: "GLS", invoiced: "418", agreed: "418", from: [-190, -96, -14] },
  { carrier: "DHL", invoiced: "1.072", agreed: "1.072", from: [200, -128, 12] },
  { carrier: "PostNord", invoiced: "1.240", agreed: "1.054", from: [-206, 92, 10], deviation: "+186 kr." },
  { carrier: "DAO", invoiced: "655", agreed: "655", from: [196, 118, -12] },
];

const SAVED = "4.860";

function times(...points: number[]) {
  return points.map((point) => Math.min(1, Math.max(0, point)).toFixed(3)).join(";");
}

function Appear({ at, until = 0.9 }: { at: number; until?: number }) {
  return (
    <animate
      attributeName="opacity"
      dur={`${LOOP}s`}
      repeatCount="indefinite"
      values="0;0;1;1;0;0"
      keyTimes={times(0, at, at + 0.02, until, until + 0.04, 1)}
    />
  );
}

function Vehicle({ lane }: { lane: Lane }) {
  return (
    <g>
      <g transform={`scale(${lane.reverse && lane.kind !== "plane" ? -(lane.scale ?? 1) : lane.scale ?? 1} ${lane.scale ?? 1})`}>
        <use href={`#hm-${lane.kind}`} />
      </g>
      <animateMotion
        dur={`${lane.dur}s`}
        begin={`${lane.begin}s`}
        repeatCount="indefinite"
        path={lane.path}
        rotate={lane.kind === "ship" ? "0" : lane.kind === "plane" && lane.reverse ? "auto-reverse" : "auto"}
        keyPoints={lane.reverse ? "1;0" : "0;1"}
        keyTimes="0;1"
        calcMode="linear"
      />
    </g>
  );
}

function Odometer({ value, x, y }: { value: string; x: number; y: number }) {
  const line = 30;
  let cursor = x;
  return (
    <g clipPath="url(#hm-odometer)">
      <Appear at={0.46} />
      {[...value].map((char, index) => {
        const left = cursor;
        cursor += char === "." ? 6 : 13;
        if (char === ".") return <text key={index} x={left} y={y} className="hm-total">.</text>;
        const digit = Number(char);
        return (
          <g key={index}>
            <text x={left} y={y} className="hm-total">
              {Array.from({ length: 10 }, (_, d) => <tspan key={d} x={left} y={y + d * line}>{d}</tspan>)}
            </text>
            <animateTransform
              attributeName="transform"
              type="translate"
              dur={`${LOOP}s`}
              repeatCount="indefinite"
              values={`0 0;0 0;0 ${-digit * line};0 ${-digit * line};0 0;0 0`}
              keyTimes={times(0, 0.5 + index * 0.012, 0.68, 0.94, 0.95, 1)}
              calcMode="spline"
              keySplines="0 0 1 1;.15 .7 .3 1;0 0 1 1;0 0 1 1;0 0 1 1"
            />
          </g>
        );
      })}
    </g>
  );
}

export function HeroMotion() {
  const svg = useRef<SVGSVGElement>(null);

  useEffect(() => {
    const node = svg.current;
    if (!node) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
    let visible = true;
    const sync = () => {
      if (reduce.matches) {
        node.pauseAnimations();
        node.setCurrentTime(STILL_AT);
      } else if (visible && !document.hidden) {
        node.unpauseAnimations();
      } else {
        node.pauseAnimations();
      }
    };
    const observer = new IntersectionObserver(([entry]) => {
      visible = entry?.isIntersecting ?? true;
      sync();
    });
    observer.observe(node);
    reduce.addEventListener("change", sync);
    document.addEventListener("visibilitychange", sync);
    sync();
    return () => {
      observer.disconnect();
      reduce.removeEventListener("change", sync);
      document.removeEventListener("visibilitychange", sync);
    };
  }, []);

  return (
    <div className="hero-motion" aria-hidden="true">
      <svg ref={svg} viewBox="0 0 560 400" role="presentation" focusable="false">
        <defs>
          <radialGradient id="hm-calm">
            <stop stopColor={MINT} stopOpacity=".55" />
            <stop offset="1" stopColor={MINT} stopOpacity="0" />
          </radialGradient>
          <filter id="hm-shadow" x="-20%" y="-20%" width="140%" height="150%">
            <feDropShadow dx="0" dy="14" stdDeviation="14" floodColor="#14282a" floodOpacity=".12" />
          </filter>
          <clipPath id="hm-odometer"><rect x="160" y="284" width="70" height="23" /></clipPath>
          <g id="hm-plane">
            <path d="M15 0 5-2.2-1-12h-4.5L-2-2.2h-8l-3.2-4.3h-2.6l1.6 6.5-1.6 6.5h2.6L-10 2.2h8L-5.5 12H-1L5 2.2Z" fill={BLUE} />
          </g>
          <g id="hm-truck">
            <rect x="-15" y="-7" width="20" height="12" rx="2" fill={TEAL} />
            <rect x="6" y="-4" width="9" height="9" rx="2" fill={BLUE} />
            <rect x="11" y="-2.5" width="3" height="3" rx=".8" fill={MINT} />
            <circle cx="-10" cy="5.5" r="2.2" fill="#14282a" />
            <circle cx="-2" cy="5.5" r="2.2" fill="#14282a" />
            <circle cx="10" cy="5.5" r="2.2" fill="#14282a" />
          </g>
          <g id="hm-ship">
            <rect x="-20" y="-16" width="7" height="12" rx="1" fill={BLUE} />
            <rect x="-11" y="-9" width="9" height="7" fill={TEAL} />
            <rect x="-1" y="-9" width="9" height="7" fill={GREEN} />
            <rect x="9" y="-9" width="9" height="7" fill={TEAL} />
            <rect x="-6" y="-15" width="9" height="6" fill={MINT} />
            <rect x="4" y="-15" width="9" height="6" fill={TEAL} />
            <path d="M-28-2H30L22 9H-22Z" fill={BLUE} />
          </g>
        </defs>

        <g className="hm-routes">
          <path d="M-40 78C140 6 380 52 600 18M600 150C450 66 220 120-40 44M70 440C160 270 380 170 600-30M-40 230C120 170 260 210 600 120" className="hm-air" />
          <path d="M-40 312C110 288 210 358 330 340S510 292 600 322M480-20C430 120 560 210 470 420M64-20C124 120 18 250 92 420" className="hm-road" />
          <path d="M-10 377q15-5 30 0t30 0 30 0 30 0 30 0 30 0 30 0 30 0 30 0 30 0 30 0 30 0 30 0 30 0 30 0 30 0 30 0 30 0 30 0 30 0" className="hm-wave" />
        </g>

        {LANES.map((lane, index) => <Vehicle key={index} lane={lane} />)}

        <circle cx="280" cy="200" r="190" fill="url(#hm-calm)" />

        <g filter="url(#hm-shadow)">
          <rect x="150" y="80" width="260" height="244" rx="16" fill="#fff" stroke="#e0e8e5" />
        </g>
        <image href="/logo.svg" x="166" y="98" width="30" height="20" />
        <text x="202" y="113" className="hm-brand">Freightlytics</text>
        <rect x="318" y="100" width="76" height="18" rx="9" fill="#e8f6ef" />
        <text x="356" y="112.5" className="hm-pill">Prisaftale</text>
        <text x="166" y="140" className="hm-head">Linje</text>
        <text x="300" y="140" className="hm-head" textAnchor="end">Faktura</text>
        <text x="356" y="140" className="hm-head" textAnchor="end">Aftale</text>
        <path d="M166 146H394" stroke="#e0e8e5" />

        {ROWS.map((row, index) => {
          const y = 150 + index * 26;
          const at = 0.05 + index * 0.09;
          const land = at + 0.07;
          const [dx, dy, turn] = row.from;
          return (
            <g key={row.carrier}>
              <rect x="160" y={y} width="240" height="22" rx="6" fill={MINT} opacity="0">
                <animate attributeName="opacity" dur={`${LOOP}s`} repeatCount="indefinite" values="0;0;.9;0;0" keyTimes={times(0, land, land + 0.005, land + 0.06, 1)} />
              </rect>
              {row.deviation ? (
                <rect x="160" y={y} width="240" height="22" rx="6" fill="#fff3e8" stroke="#f0cfb4">
                  <Appear at={land + 0.04} />
                </rect>
              ) : null}
              <g>
                <Appear at={at} />
                <animateTransform
                  attributeName="transform"
                  type="translate"
                  dur={`${LOOP}s`}
                  repeatCount="indefinite"
                  values={`${dx} ${dy};${dx} ${dy};0 0;0 0`}
                  keyTimes={times(0, at, land, 1)}
                  calcMode="spline"
                  keySplines="0 0 1 1;.2 .8 .25 1;0 0 1 1"
                />
                <animateTransform
                  attributeName="transform"
                  type="rotate"
                  additive="sum"
                  dur={`${LOOP}s`}
                  repeatCount="indefinite"
                  values={`${turn} 280 ${y + 11};${turn} 280 ${y + 11};0 280 ${y + 11};0 280 ${y + 11}`}
                  keyTimes={times(0, at, land, 1)}
                  calcMode="spline"
                  keySplines="0 0 1 1;.2 .8 .25 1;0 0 1 1"
                />
                <rect x="160" y={y} width="240" height="22" rx="6" fill="#fff" stroke="#c7d6d0">
                  <animate attributeName="opacity" dur={`${LOOP}s`} repeatCount="indefinite" values="1;1;0;0" keyTimes={times(0, land, land + 0.03, 1)} />
                </rect>
                <text x="166" y={y + 15} className="hm-cell">{row.carrier}</text>
                <text x="300" y={y + 15} className="hm-cell hm-num" textAnchor="end">{row.invoiced}</text>
                <text x="356" y={y + 15} className="hm-cell hm-num hm-muted" textAnchor="end">{row.agreed}</text>
              </g>
              {row.deviation ? (
                <g>
                  <Appear at={land + 0.05} />
                  <circle cx="380" cy={y + 11} r="7" fill={AMBER} />
                  <path d={`M380 ${y + 7}v4.5M380 ${y + 14}v.5`} stroke="#fff" strokeWidth="1.8" strokeLinecap="round" />
                </g>
              ) : (
                <g>
                  <Appear at={land + 0.01} />
                  <circle cx="380" cy={y + 11} r="7" fill={MINT} />
                  <path d={`M376.8 ${y + 11}l2.2 2.2 4-4.4`} stroke={GREEN} strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round" />
                </g>
              )}
              {row.deviation ? (
                <g>
                  <Appear at={land + 0.07} />
                  <rect x="392" y={y + 2} width="62" height="18" rx="9" fill={AMBER} />
                  <text x="423" y={y + 14.5} className="hm-flag">{row.deviation}</text>
                </g>
              ) : null}
            </g>
          );
        })}

        <path d="M166 260H394" stroke="#e0e8e5" />
        <text x="166" y="278" className="hm-head">Besparelse fundet</text>
        <Odometer value={SAVED} x={166} y={302} />
        <text x="230" y="302" className="hm-total hm-unit">
          <Appear at={0.46} />
          kr.
        </text>
        <rect x="314" y="286" width="80" height="22" rx="11" fill={GREEN}>
          <Appear at={0.68} />
        </rect>
        <text x="354" y="301" className="hm-done">
          <Appear at={0.68} />
          Klar til krav
        </text>
      </svg>
    </div>
  );
}
