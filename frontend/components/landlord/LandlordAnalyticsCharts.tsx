"use client";

import {
  LineChart,
  Line,
  AreaChart,
  Area,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import type { LandlordAnalytics } from "@/lib/landlordApi";

interface LandlordAnalyticsChartsProps {
  analytics: LandlordAnalytics | null;
  loading: boolean;
}

export default function LandlordAnalyticsCharts({
  analytics,
  loading,
}: LandlordAnalyticsChartsProps) {
  return (
    <div className="grid gap-6 md:grid-cols-2">
      {/* Occupancy Trend */}
      <Card className="border-3 border-foreground shadow-[6px_6px_0px_0px_rgba(0,0,0,1)]">
        <CardHeader>
          <CardTitle className="font-bold">Occupancy Trend</CardTitle>
          <CardDescription className="font-medium">
            Portfolio occupancy percentage over time
          </CardDescription>
        </CardHeader>
        <CardContent className="h-[300px]">
          {loading ? (
            <Skeleton className="h-full w-full" />
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={analytics?.occupancyTrend}>
                <defs>
                  <linearGradient id="colorRate" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="var(--chart-1)" stopOpacity={0.8} />
                    <stop offset="95%" stopColor="var(--chart-1)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="date" />
                <YAxis unit="%" />
                <Tooltip />
                <Area
                  type="monotone"
                  dataKey="rate"
                  stroke="var(--chart-1)"
                  fillOpacity={1}
                  fill="url(#colorRate)"
                  strokeWidth={3}
                />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      {/* Revenue Breakdown */}
      <Card className="border-3 border-foreground shadow-[6px_6px_0px_0px_rgba(0,0,0,1)]">
        <CardHeader>
          <CardTitle className="font-bold">Revenue Breakdown</CardTitle>
          <CardDescription className="font-medium">
            Expected vs Collected revenue per month
          </CardDescription>
        </CardHeader>
        <CardContent className="h-[300px]">
          {loading ? (
            <Skeleton className="h-full w-full" />
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={analytics?.revenueBreakdown}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="month" />
                <YAxis />
                <Tooltip />
                <Legend />
                <Bar dataKey="expected" fill="var(--chart-2)" stroke="#000" strokeWidth={2} />
                <Bar dataKey="collected" fill="var(--chart-1)" stroke="#000" strokeWidth={2} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      {/* Payment Trends */}
      <Card className="border-3 border-foreground shadow-[6px_6px_0px_0px_rgba(0,0,0,1)]">
        <CardHeader>
          <CardTitle className="font-bold">Payment Trends</CardTitle>
          <CardDescription className="font-medium">
            Payment status distribution over time
          </CardDescription>
        </CardHeader>
        <CardContent className="h-[300px]">
          {loading ? (
            <Skeleton className="h-full w-full" />
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={analytics?.paymentTrends}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="date" />
                <YAxis unit="%" />
                <Tooltip />
                <Legend />
                <Line
                  type="monotone"
                  dataKey="onTime"
                  stroke="var(--chart-2)"
                  strokeWidth={3}
                  dot={{ r: 6 }}
                  activeDot={{ r: 8 }}
                />
                <Line
                  type="monotone"
                  dataKey="late"
                  stroke="var(--chart-4)"
                  strokeWidth={3}
                  dot={{ r: 6 }}
                />
                <Line
                  type="monotone"
                  dataKey="missed"
                  stroke="var(--chart-5)"
                  strokeWidth={3}
                  dot={{ r: 6 }}
                />
              </LineChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      {/* Portfolio Health (Pie) */}
      <Card className="border-3 border-foreground shadow-[6px_6px_0px_0px_rgba(0,0,0,1)]">
        <CardHeader>
          <CardTitle className="font-bold">Portfolio Health</CardTitle>
          <CardDescription className="font-medium">
            Quick glance at vacancy vs occupied units
          </CardDescription>
        </CardHeader>
        <CardContent className="h-[300px] flex items-center justify-center">
          {loading ? (
            <Skeleton className="h-full w-full" />
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={[
                    {
                      name: "Occupied",
                      value:
                        100 -
                        (analytics?.vacancyMetrics.currentVacancyCount || 0) * 10,
                    },
                    {
                      name: "Vacant",
                      value:
                        (analytics?.vacancyMetrics.currentVacancyCount || 0) * 10,
                    },
                  ]}
                  cx="50%"
                  cy="50%"
                  innerRadius={60}
                  outerRadius={80}
                  paddingAngle={5}
                  dataKey="value"
                >
                  <Cell fill="var(--chart-2)" />
                  <Cell fill="var(--chart-5)" />
                </Pie>
                <Tooltip />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
