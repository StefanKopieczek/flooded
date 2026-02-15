import { useMemo } from "react";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
} from "recharts";
import type { EAReading } from "../types";
import { THRESHOLDS } from "../types";
import { format } from "date-fns";

interface Props {
  readings: EAReading[];
  days: number;
}

export default function RiverChart({ readings, days }: Props) {
  const chartData = useMemo(() => {
    const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
    return readings
      .filter((r) => new Date(r.dateTime).getTime() >= cutoff)
      .map((r) => ({
        time: new Date(r.dateTime).getTime(),
        value: r.value,
      }));
  }, [readings, days]);

  const yDomain = useMemo(() => {
    if (chartData.length === 0) return [0, 5];
    const values = chartData.map((d) => d.value);
    const min = Math.min(...values);
    const max = Math.max(...values, THRESHOLDS.ROAD_FLOOD + 0.2);
    return [Math.max(0, Math.floor(min * 2) / 2 - 0.5), Math.ceil(max * 2) / 2 + 0.3];
  }, [chartData]);

  const formatXAxis = (time: number) => {
    if (days <= 1) return format(new Date(time), "HH:mm");
    if (days <= 7) return format(new Date(time), "EEE HH:mm");
    return format(new Date(time), "dd MMM");
  };

  const formatTooltip = (time: number) => {
    return format(new Date(time), "EEE dd MMM, HH:mm");
  };

  if (chartData.length === 0) {
    return <div className="chart-empty">No data available for this time range.</div>;
  }

  return (
    <div className="river-chart">
      <ResponsiveContainer width="100%" height={320}>
        <AreaChart data={chartData} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
          <defs>
            <linearGradient id="waterGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#3b82f6" stopOpacity={0.4} />
              <stop offset="100%" stopColor="#3b82f6" stopOpacity={0.05} />
            </linearGradient>
          </defs>
          <CartesianGrid
            strokeDasharray="3 3"
            stroke="rgba(255,255,255,0.06)"
            vertical={false}
          />
          <XAxis
            dataKey="time"
            type="number"
            domain={["dataMin", "dataMax"]}
            tickFormatter={formatXAxis}
            stroke="rgba(255,255,255,0.3)"
            tick={{ fill: "rgba(255,255,255,0.5)", fontSize: 11 }}
            tickLine={false}
            axisLine={false}
            minTickGap={60}
          />
          <YAxis
            domain={yDomain}
            stroke="rgba(255,255,255,0.3)"
            tick={{ fill: "rgba(255,255,255,0.5)", fontSize: 11 }}
            tickLine={false}
            axisLine={false}
            tickFormatter={(v: number) => `${v.toFixed(1)}m`}
          />
          <Tooltip
            contentStyle={{
              background: "rgba(15, 23, 42, 0.95)",
              border: "1px solid rgba(255,255,255,0.1)",
              borderRadius: "8px",
              color: "#e2e8f0",
              fontSize: "13px",
            }}
            labelFormatter={(label) => formatTooltip(label as number)}
            formatter={(value) => [`${Number(value).toFixed(2)}m`, "Level"]}
          />
          <ReferenceLine
            y={THRESHOLDS.ROAD_FLOOD}
            stroke="#ef4444"
            strokeDasharray="6 4"
            strokeWidth={1.5}
            label={{
              value: `Road floods (${THRESHOLDS.ROAD_FLOOD}m)`,
              position: "insideTopRight",
              fill: "#ef4444",
              fontSize: 11,
              fontWeight: 500,
              dy: -24,
            }}
          />
          <ReferenceLine
            y={THRESHOLDS.FLOOD_WARNING}
            stroke="#f59e0b"
            strokeDasharray="4 4"
            strokeWidth={1}
            label={{
              value: `Warning (${THRESHOLDS.FLOOD_WARNING}m)`,
              position: "insideTopRight",
              fill: "#f59e0b",
              fontSize: 11,
            }}
          />
          <ReferenceLine
            y={THRESHOLDS.NORMAL_HIGH}
            stroke="rgba(255,255,255,0.2)"
            strokeDasharray="3 3"
            strokeWidth={1}
          />
          <Area
            type="monotone"
            dataKey="value"
            stroke="#3b82f6"
            strokeWidth={2}
            fill="url(#waterGradient)"
            dot={false}
            activeDot={{
              r: 4,
              fill: "#3b82f6",
              stroke: "#fff",
              strokeWidth: 2,
            }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
