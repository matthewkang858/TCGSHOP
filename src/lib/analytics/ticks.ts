/**
 * Clean axis ticks for a money axis. Recharts' automatic ticks divide the
 * data range evenly, which on a $340 maximum yields $85 / $170 / $255 - true,
 * but not numbers anyone reads at a glance. These land on 1-2-5 steps
 * (or 2.5 once the step is $25 or more) and always include zero.
 */

const round = (n: number) => Math.round(n * 1e6) / 1e6;

export function niceStep(range: number, targetIntervals = 4): number {
  if (!(range > 0) || !Number.isFinite(range)) return 1;
  const rough = range / targetIntervals;
  const pow = Math.pow(10, Math.floor(Math.log10(rough)));
  const multiples = pow >= 10 ? [1, 2, 2.5, 5, 10] : [1, 2, 5, 10];
  for (const m of multiples) {
    if (round(m * pow) >= rough) return round(m * pow);
  }
  return round(10 * pow);
}

/** Ticks from the lowest of (0, min) to the highest of (0, max), on a nice step. */
export function niceTicks(min: number, max: number, targetIntervals = 4): number[] {
  const lo = Math.min(0, Number.isFinite(min) ? min : 0);
  const hi = Math.max(0, Number.isFinite(max) ? max : 0);
  if (hi === lo) return [0];
  const step = niceStep(hi - lo, targetIntervals);
  const first = Math.floor(lo / step) * step;
  const last = Math.ceil(hi / step) * step;
  const ticks: number[] = [];
  for (let v = first; v <= last + step / 1e6; v += step) ticks.push(round(v));
  return ticks;
}
