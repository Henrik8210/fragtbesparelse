import type { MonthTrackPoint } from "../data/portfolio.ts";

type MonthTrack = {
  spent: number;
  budget: number;
  points: MonthTrackPoint[];
};

export function withBillSpend(track: MonthTrack, extra: number): MonthTrack {
  if (!extra) return track;
  return {
    ...track,
    spent: track.spent + extra,
    points: track.points.map((point, index) =>
      index === track.points.length - 1 ? { ...point, spent: point.spent + extra } : point,
    ),
  };
}
