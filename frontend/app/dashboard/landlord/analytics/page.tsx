"use client";

import { useState, useEffect, useCallback } from "react";
import { 
  BarChart3, 
  Calendar as CalendarIcon, 
  ChevronDown, 
  TrendingUp, 
  TrendingDown, 
  Users, 
  DollarSign, 
  Building2, 
  Clock,
  Filter,
  Download,
  Loader2,
  AlertCircle
} from "lucide-react";
import { format, subDays, startOfMonth, endOfMonth } from "date-fns";
import dynamic from "next/dynamic";
import { landlordApi, LandlordAnalytics, LandlordProperty } from "@/lib/landlordApi";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { LandlordSidebar } from "@/components/landlord/LandlordSidebar";
import { DashboardHeader } from "@/components/dashboard-header";

const LandlordAnalyticsCharts = dynamic(
  () => import("@/components/landlord/LandlordAnalyticsCharts"),
  {
    ssr: false,
    loading: () => (
      <div className="grid gap-6 md:grid-cols-2">
        {[0, 1, 2, 3].map((i) => (
          <div
            key={i}
            className="border-3 border-foreground shadow-[6px_6px_0px_0px_rgba(0,0,0,1)] p-6 animate-pulse"
          >
            <div className="h-5 w-40 bg-muted rounded mb-2" />
            <div className="h-4 w-56 bg-muted rounded mb-4" />
            <div className="h-[300px] w-full bg-muted rounded" />
          </div>
        ))}
      </div>
    ),
  },
);

export default function LandlordAnalyticsPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [analytics, setAnalytics] = useState<LandlordAnalytics | null>(null);
  const [isUsingMock, setIsUsingMock] = useState(false);
  const [properties, setProperties] = useState<LandlordProperty[]>([]);
  const [selectedProperty, setSelectedProperty] = useState<string>("all");
  const [dateRange, setDateRange] = useState<{ from: Date; to: Date }>({
    from: startOfMonth(subDays(new Date(), 90)),
    to: new Date(),
  });

  useEffect(() => {
    fetchInitialData();
  }, []);

  const fetchAnalytics = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      setIsUsingMock(false);
      const data = await landlordApi.getAnalytics({
        propertyId: selectedProperty === "all" ? undefined : selectedProperty,
        startDate: format(dateRange.from, "yyyy-MM-dd"),
        endDate: format(dateRange.to, "yyyy-MM-dd"),
      });
      setAnalytics(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load analytics data");
      if (process.env.NODE_ENV === 'development') {
        mockAnalytics();
        setIsUsingMock(true);
      }
    } finally {
      setLoading(false);
    }
  }, [selectedProperty, dateRange]);

  useEffect(() => {
    fetchAnalytics();
  }, [fetchAnalytics]);

  const fetchInitialData = async () => {
    try {
      const props = await landlordApi.getProperties();
      setProperties(props);
    } catch (err) {
      console.error("Failed to fetch properties", err);
    }
  };

  const mockAnalytics = () => {
    setAnalytics({
      occupancyTrend: [
        { date: "Jan", rate: 85 },
        { date: "Feb", rate: 88 },
        { date: "Mar", rate: 92 },
        { date: "Apr", rate: 90 },
        { date: "May", rate: 95 },
        { date: "Jun", rate: 98 },
      ],
      revenueBreakdown: [
        { month: "Jan", expected: 500000, collected: 450000 },
        { month: "Feb", expected: 500000, collected: 480000 },
        { month: "Mar", expected: 600000, collected: 590000 },
        { month: "Apr", expected: 600000, collected: 550000 },
        { month: "May", expected: 700000, collected: 680000 },
        { month: "Jun", expected: 700000, collected: 700000 },
      ],
      paymentTrends: [
        { date: "Jan", onTime: 70, late: 20, missed: 10 },
        { date: "Feb", onTime: 75, late: 15, missed: 10 },
        { date: "Mar", onTime: 80, late: 15, missed: 5 },
        { date: "Apr", onTime: 78, late: 12, missed: 10 },
        { date: "May", onTime: 85, late: 10, missed: 5 },
        { date: "Jun", onTime: 90, late: 8, missed: 2 },
      ],
      vacancyMetrics: {
        averageTimeToFill: 14,
        currentVacancyCount: 3
      }
    });
  };

  return (
    <div className="min-h-screen bg-background">
      <DashboardHeader />
      <LandlordSidebar />
      
      <main id="main-content" className="min-h-screen pt-20 lg:ml-64">
        <div className="p-4 md:p-8 flex flex-col gap-8">
          {isUsingMock && (
            <div className="flex items-center gap-2 rounded-xl border-3 border-amber-500 bg-amber-50 p-4 text-amber-900 shadow-[4px_4px_0px_0px_rgba(245,158,11,1)]">
              <AlertCircle className="h-5 w-5 text-amber-600" />
              <span className="text-sm font-bold">Development Banner: Displaying mock analytics data because the API request failed.</span>
            </div>
          )}
          {/* Header */}
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div>
              <h1 className="text-3xl font-bold tracking-tight">Landlord Analytics</h1>
              <p className="text-muted-foreground">Monitor your portfolio performance and trends</p>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" className="border-2 border-foreground shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]">
                <Download className="mr-2 h-4 w-4" />
                Export Data
              </Button>
            </div>
          </div>

          {/* Filters */}
          <div className="flex flex-col gap-4 rounded-xl border-3 border-foreground bg-accent p-4 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] md:flex-row md:items-center">
            <div className="flex flex-1 items-center gap-2">
              <Filter className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm font-bold">Filters:</span>
              <Select value={selectedProperty} onValueChange={setSelectedProperty}>
                <SelectTrigger className="w-[200px] border-2 border-foreground bg-background">
                  <SelectValue placeholder="All Properties" />
                </SelectTrigger>
                <SelectContent className="border-2 border-foreground">
                  <SelectItem value="all">All Properties</SelectItem>
                  {properties.map(p => (
                    <SelectItem key={p.id} value={p.id.toString()}>{p.title}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-center gap-2">
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" className="w-[260px] justify-start border-2 border-foreground bg-background text-left font-bold shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]">
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {dateRange?.from ? (
                      dateRange.to ? (
                        <>
                          {format(dateRange.from, "LLL dd, y")} -{" "}
                          {format(dateRange.to, "LLL dd, y")}
                        </>
                      ) : (
                        format(dateRange.from, "LLL dd, y")
                      )
                    ) : (
                      <span>Pick a date range</span>
                    )}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0 border-3 border-foreground" align="end">
                  <Calendar
                    initialFocus
                    mode="range"
                    defaultMonth={dateRange?.from}
                    selected={dateRange}
                    onSelect={(range: any) => range && setDateRange(range)}
                    numberOfMonths={2}
                  />
                </PopoverContent>
              </Popover>
            </div>
          </div>

          {error && (
            <div className="rounded-xl border-3 border-destructive bg-destructive/10 p-6 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
              <div className="flex items-center gap-3 text-destructive font-bold">
                <AlertCircle className="h-6 w-6" />
                <p>{error}</p>
              </div>
              <Button onClick={fetchAnalytics} className="mt-4 border-2 border-destructive bg-transparent text-destructive hover:bg-destructive hover:text-white font-bold">
                Retry
              </Button>
            </div>
          )}

          {/* Main Stats */}
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
            <Card className="border-3 border-foreground shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-bold">Occupancy Rate</CardTitle>
                <Users className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                {loading ? <Skeleton className="h-8 w-20" /> : (() => {
                  const trend = analytics?.occupancyTrend;
                  const current = trend && trend.length > 0 ? trend[trend.length - 1]?.rate : undefined;
                  const previous = trend && trend.length > 1 ? trend[trend.length - 2]?.rate : undefined;
                  const diff = current !== undefined && previous !== undefined ? Number((current - previous).toFixed(1)) : undefined;
                  return (
                    <>
                      <div className="text-2xl font-bold">{current !== undefined ? `${current}%` : "N/A"}</div>
                      {diff !== undefined ? (
                        <p className={cn("text-xs font-bold flex items-center", diff >= 0 ? "text-green-500" : "text-red-500")}>
                          {diff >= 0 ? <TrendingUp className="mr-1 h-3 w-3" /> : <TrendingDown className="mr-1 h-3 w-3" />}
                          {diff >= 0 ? `+${diff}%` : `${diff}%`} from last period
                        </p>
                      ) : (
                        <p className="text-xs text-muted-foreground font-bold">No prior period comparison</p>
                      )}
                    </>
                  );
                })()}
              </CardContent>
            </Card>

            <Card className="border-3 border-foreground shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-bold">Monthly Revenue</CardTitle>
                <DollarSign className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                {loading ? <Skeleton className="h-8 w-32" /> : (() => {
                  const breakdown = analytics?.revenueBreakdown;
                  const current = breakdown && breakdown.length > 0 ? breakdown[breakdown.length - 1]?.collected : undefined;
                  const previous = breakdown && breakdown.length > 1 ? breakdown[breakdown.length - 2]?.collected : undefined;
                  const diffPercent = current !== undefined && previous !== undefined && previous > 0 
                    ? Number((((current - previous) / previous) * 100).toFixed(1))
                    : undefined;
                  return (
                    <>
                      <div className="text-2xl font-bold">₦{current !== undefined ? current.toLocaleString() : "0"}</div>
                      {diffPercent !== undefined ? (
                        <p className={cn("text-xs font-bold flex items-center", diffPercent >= 0 ? "text-green-500" : "text-red-500")}>
                          {diffPercent >= 0 ? <TrendingUp className="mr-1 h-3 w-3" /> : <TrendingDown className="mr-1 h-3 w-3" />}
                          {diffPercent >= 0 ? `+${diffPercent}%` : `${diffPercent}%`} from last period
                        </p>
                      ) : (
                        <p className="text-xs text-muted-foreground font-bold">No prior period comparison</p>
                      )}
                    </>
                  );
                })()}
              </CardContent>
            </Card>

            <Card className="border-3 border-foreground shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-bold">Current Vacancies</CardTitle>
                <Building2 className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                {loading ? <Skeleton className="h-8 w-12" /> : (
                  <>
                    <div className="text-2xl font-bold">{analytics?.vacancyMetrics.currentVacancyCount}</div>
                    <p className="text-xs text-muted-foreground font-bold italic">Units ready for lease</p>
                  </>
                )}
              </CardContent>
            </Card>

            <Card className="border-3 border-foreground shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-bold">Avg. Time to Fill</CardTitle>
                <Clock className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                {loading ? <Skeleton className="h-8 w-24" /> : (
                  <>
                    <div className="text-2xl font-bold">{analytics?.vacancyMetrics.averageTimeToFill} Days</div>
                    <p className="text-xs text-muted-foreground font-bold italic">Average portfolio turnaround</p>
                  </>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Charts Grid */}
          <LandlordAnalyticsCharts analytics={analytics} loading={loading} />
        </div>
      </main>
    </div>
  );
}
