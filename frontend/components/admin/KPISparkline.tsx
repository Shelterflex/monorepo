"use client";

import { ResponsiveContainer, AreaChart, Area } from "recharts";

interface KPISparklineProps {
  data: { name: string; value: number }[];
  isPositive: boolean;
  isNegative: boolean;
  gradientId: string;
}

export default function KPISparkline({
  data,
  isPositive,
  isNegative,
  gradientId,
}: KPISparklineProps) {
  const color = isPositive ? "#22c55e" : isNegative ? "#ef4444" : "#f59e0b";
  const strokeColor = isPositive ? "#16a34a" : isNegative ? "#dc2626" : "#d97706";

  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={data} margin={{ top: 0, right: 0, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.4} />
            <stop offset="100%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
        <Area
          type="monotone"
          dataKey="value"
          stroke={strokeColor}
          strokeWidth={2.5}
          fill={`url(#${gradientId})`}
          dot={false}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
