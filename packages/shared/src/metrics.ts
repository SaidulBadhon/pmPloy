export type MetricSample = {
  t: number; // unix-ms timestamp
  cpu: number; // percent (0-100, can exceed 100 on multi-core)
  memory: number; // bytes
};

/**
 * Append a sample, dropping the oldest entries to keep at most `max` items.
 * Pure so it's easy to unit-test and safe to use in React state setters.
 */
export function appendSample(
  history: ReadonlyArray<MetricSample>,
  sample: MetricSample,
  max: number,
): MetricSample[] {
  const next = [...history, sample];
  return next.length <= max ? next : next.slice(next.length - max);
}

export const METRIC_HISTORY_MAX = 120; // ~6 minutes at 3s polling
