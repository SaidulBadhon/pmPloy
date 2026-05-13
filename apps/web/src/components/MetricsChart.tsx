import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { MetricSample } from "@pmploy/shared";
import { bytes } from "../lib/format";

function formatTime(t: number): string {
  const d = new Date(t);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}:${String(d.getSeconds()).padStart(2, "0")}`;
}

export function MetricsChart({ samples }: { samples: MetricSample[] }) {
  if (samples.length < 2) {
    return (
      <p className="py-6 text-center text-sm text-neutral-500">
        Waiting for samples…
      </p>
    );
  }
  return (
    <div className="grid gap-6 md:grid-cols-2">
      <div>
        <p className="mb-1 text-xs text-neutral-500">CPU %</p>
        <div className="h-48">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={samples} margin={{ top: 4, right: 8, bottom: 0, left: -16 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#262626" />
              <XAxis
                dataKey="t"
                stroke="#525252"
                fontSize={10}
                tickFormatter={formatTime}
              />
              <YAxis stroke="#525252" fontSize={10} />
              <Tooltip
                contentStyle={{
                  background: "#0a0a0a",
                  border: "1px solid #262626",
                  fontSize: 12,
                }}
                labelFormatter={(t) => formatTime(t as number)}
                formatter={(v: number) => [`${v.toFixed(1)}%`, "cpu"]}
              />
              <Line
                type="monotone"
                dataKey="cpu"
                stroke="#34d399"
                strokeWidth={1.5}
                dot={false}
                isAnimationActive={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>
      <div>
        <p className="mb-1 text-xs text-neutral-500">Memory</p>
        <div className="h-48">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={samples} margin={{ top: 4, right: 8, bottom: 0, left: -16 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#262626" />
              <XAxis
                dataKey="t"
                stroke="#525252"
                fontSize={10}
                tickFormatter={formatTime}
              />
              <YAxis stroke="#525252" fontSize={10} tickFormatter={(v) => bytes(v)} />
              <Tooltip
                contentStyle={{
                  background: "#0a0a0a",
                  border: "1px solid #262626",
                  fontSize: 12,
                }}
                labelFormatter={(t) => formatTime(t as number)}
                formatter={(v: number) => [bytes(v), "memory"]}
              />
              <Line
                type="monotone"
                dataKey="memory"
                stroke="#60a5fa"
                strokeWidth={1.5}
                dot={false}
                isAnimationActive={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}
