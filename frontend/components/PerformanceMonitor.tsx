"use client";

import { useEffect } from "react";
import { performanceMonitor } from "@/lib/performance-monitor";

export function PerformanceMonitor() {
  useEffect(() => {
    // Initialize performance monitoring
    performanceMonitor.setBudgets({
      fcp: 1800,
      lcp: 2500,
      inp: 200,
      cls: 0.1,
      ttfb: 800,
    });

    // Log metrics in development
    if (process.env.NODE_ENV === "development") {
      const interval = setInterval(() => {
        const metrics = performanceMonitor.getMetrics();
        if (metrics.size > 0) {
          console.log("[Performance]", Object.fromEntries(metrics));
        }
      }, 10000);

      return () => clearInterval(interval);
    }
  }, []);

  return null;
}
