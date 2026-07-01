/** Small numeric helpers shared by the frame meter and the benchmark. */

export const median = (values: number[]): number => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middleIndex = Math.floor(sorted.length / 2);
  return sorted[middleIndex];
};

export const average = (values: number[]): number =>
  values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;

export const roundToTenths = (value: number): number => Math.round(value * 10) / 10;
