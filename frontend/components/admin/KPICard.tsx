import React from "react";
import { ArrowUpRight, ArrowDownRight, Minus } from "lucide-react";
import { ResponsiveContainer, AreaChart, Area } from "recharts";
import { LoadingState } from "@/components/ui/data-state";

export interface KPICardProps {
  title: string;
  /**
   * Accepts a node so callers can pass `<MoneyValue>` and keep monetary figures
   * out of the "render a fallback number" path.
   */
  value: React.ReactNode;
  change?: number; // e.g. 12.4 for +12.4%, -3.2 for -3.2%
  changeLabel?: string; // e.g. "vs last month"
  sparklineData?: number[]; // array of trend values
  icon?: React.ReactNode;
  isLoading?: boolean;
}

export function KPICard({
  title,
  value,
  change,
  changeLabel = "vs last period",
  sparklineData = [30, 40, 35, 50, 49, 60, 70, 91],
  icon,
  isLoading = false,
}: KPICardProps) {
  // Map raw array of numbers to recharts format
  const chartData = sparklineData.map((val, index) => ({
    name: index.toString(),
    value: val,
  }));

  const isPositive = change !== undefined && change > 0;
  const isNegative = change !== undefined && change < 0;

  if (isLoading) {
    return (
      <LoadingState
        label={`Loading ${title}`}
        className="border-3 border-foreground bg-card p-6 shadow-[4px_4px_0px_0px_rgba(26,26,26,1)] animate-pulse flex flex-col justify-between h-40"
      >
        <div>
          <div className="h-4 w-24 bg-muted border-2 border-foreground/10 mb-2"></div>
          <div className="h-8 w-32 bg-muted border-2 border-foreground/10"></div>
        </div>
        <div className="h-4 w-40 bg-muted border-2 border-foreground/10"></div>
      </LoadingState>
    );
  }

  return (
    <div className="border-3 border-foreground bg-card p-6 shadow-[4px_4px_0px_0px_rgba(26,26,26,1)] flex flex-col justify-between relative overflow-hidden group hover:translate-x-0.5 hover:translate-y-0.5 hover:shadow-[2px_2px_0px_0px_rgba(26,26,26,1)] transition-all h-40">
      {/* Top Section */}
      <div className="flex justify-between items-start z-10">
        <div>
          <span className="font-mono text-xs font-bold text-muted-foreground uppercase tracking-wider block">
            {title}
          </span>
          <h3 className="font-mono text-3xl font-black mt-1 leading-tight tracking-tight">
            {value}
          </h3>
        </div>
        {icon && (
          <div className="flex h-10 w-10 items-center justify-center border-2 border-foreground bg-secondary shadow-[2px_2px_0px_0px_rgba(26,26,26,1)] group-hover:bg-primary transition-colors">
            {icon}
          </div>
        )}
      </div>

      {/* Bottom Section with Sparkline & Trend */}
      <div className="flex items-end justify-between mt-4 z-10">
        <div className="flex items-center gap-1.5">
          {change !== undefined ? (
            <>
              <span
                className={`inline-flex items-center gap-0.5 border-2 px-1.5 py-0.5 text-xs font-bold font-mono ${
                  isPositive
                    ? "border-green-600 bg-green-50 text-green-700"
                    : isNegative
                      ? "border-red-600 bg-red-50 text-red-700"
                      : "border-muted-foreground/30 bg-muted text-muted-foreground"
                }`}
              >
                {isPositive ? (
                  <ArrowUpRight className="w-3.5 h-3.5" />
                ) : isNegative ? (
                  <ArrowDownRight className="w-3.5 h-3.5" />
                ) : (
                  <Minus className="w-3.5 h-3.5" />
                )}
                {change > 0 ? `+${change}` : change}%
              </span>
              <span className="text-[11px] text-muted-foreground font-mono font-medium">
                {changeLabel}
              </span>
            </>
          ) : (
            <span className="text-xs text-muted-foreground font-mono">
              Live updates active
            </span>
          )}
        </div>

        {/* Mini Sparkline Chart */}
        <div
          role="img"
          aria-label={
            sparklineData.length > 0
              ? `${title} trend: ${sparklineData.join(", ")}`
              : `${title} trend: no data`
          }
          className="absolute right-2 bottom-2 w-28 h-12 opacity-60 group-hover:opacity-90 transition-opacity"
        >
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chartData} margin={{ top: 0, right: 0, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id={`gradient-${title}`} x1="0" y1="0" x2="0" y2="1">
                  <stop
                    offset="0%"
                    stopColor={isPositive ? "#22c55e" : isNegative ? "#ef4444" : "#f59e0b"}
                    stopOpacity={0.4}
                  />
                  <stop
                    offset="100%"
                    stopColor={isPositive ? "#22c55e" : isNegative ? "#ef4444" : "#f59e0b"}
                    stopOpacity={0}
                  />
                </linearGradient>
              </defs>
              <Area
                type="monotone"
                dataKey="value"
                stroke={isPositive ? "#16a34a" : isNegative ? "#dc2626" : "#d97706"}
                strokeWidth={2.5}
                fill={`url(#gradient-${title})`}
                dot={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}
