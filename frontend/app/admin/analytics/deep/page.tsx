import AnalyticsDashboard from "@/components/analytics-dashboard";
import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Advanced Analytics & Funnels | ShelterFlex Dashboard",
  description:
    "Complements the main admin analytics dashboard by providing detailed client-side funnel tracking, performance metrics (FCP, LCP, FID), and user consent analytics.",
};

export default function AdminDeepAnalyticsPage() {
  return (
    <div className="container mx-auto py-6 px-4 max-w-7xl">
      <div className="mb-6 bg-blue-50 border border-blue-200 rounded-lg p-4">
        <h2 className="font-semibold text-blue-900 mb-1">
          Deep Analytics & Client-Side Telemetry
        </h2>
        <p className="text-sm text-blue-800">
          While{" "}
          <Link href="/admin/analytics" className="underline font-medium">
            /admin/analytics
          </Link>{" "}
          focuses on platform server KPIs, revenue timelines, and deal funnels
          via <code>AdminAnalyticsClient.tsx</code>, this view provides granular
          client-side performance tracking, funnel analytics, consent manager
          preferences, and raw event statistics.
        </p>
      </div>
      <AnalyticsDashboard />
    </div>
  );
}
