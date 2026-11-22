export const hrfTicks = [0, 25, 50, 75, 100];

export function toHrf(index: number, sampleCount: number) {
  return sampleCount > 1 ? (index * 100) / (sampleCount - 1) : 0;
}

export type PeakBounds = { x0: number; x1: number };
