import { useEffect, useRef, useState } from "react";
import {
  appendSample,
  METRIC_HISTORY_MAX,
  type MetricSample,
  type Pm2Info,
} from "@pmploy/shared";

/**
 * Accumulates PM2 cpu/memory snapshots into a bounded history buffer.
 * Returns the latest series to feed into a chart.
 */
export function useMetricSamples(pm2: Pm2Info | null): MetricSample[] {
  const [series, setSeries] = useState<MetricSample[]>([]);
  // Avoid pushing duplicate samples when the parent re-renders without a new poll.
  const lastIngestedRef = useRef<string>("");

  useEffect(() => {
    if (!pm2) return;
    // Use the trio of fields as a coarse change key. PM2 includes uptime which
    // changes every poll, so this catches almost all genuine refreshes.
    const key = `${pm2.uptime}:${pm2.cpu}:${pm2.memory}`;
    if (key === lastIngestedRef.current) return;
    lastIngestedRef.current = key;
    setSeries((cur) =>
      appendSample(
        cur,
        { t: Date.now(), cpu: pm2.cpu, memory: pm2.memory },
        METRIC_HISTORY_MAX,
      ),
    );
  }, [pm2]);

  return series;
}
