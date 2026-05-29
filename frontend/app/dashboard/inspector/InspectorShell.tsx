"use client";

import Link from "next/link";
import { ClipboardCheck, DollarSign, LayoutDashboard, SearchCheck } from "lucide-react";
import { DashboardHeader } from "@/components/dashboard-header";

const navItems = [
  { href: "/dashboard/inspector", label: "Overview", icon: LayoutDashboard },
  { href: "/dashboard/inspector/jobs", label: "Job Board", icon: SearchCheck },
  { href: "/dashboard/inspector/earnings", label: "Earnings", icon: DollarSign },
];

export function InspectorShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-background">
      <DashboardHeader />
      <aside className="fixed left-0 top-0 hidden h-screen w-64 border-r-3 border-foreground bg-card pt-20 lg:block">
        <div className="p-4">
          <div className="mb-6 border-3 border-foreground bg-accent p-4 shadow-[4px_4px_0px_0px_rgba(26,26,26,1)]">
            <div className="flex items-center gap-2 font-bold">
              <ClipboardCheck className="h-5 w-5" />
              Inspector
            </div>
            <p className="mt-1 text-sm text-muted-foreground">Field verification desk</p>
          </div>
          <nav className="space-y-2">
            {navItems.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="flex items-center gap-3 border-3 border-foreground bg-card p-3 font-bold transition-all hover:bg-muted hover:shadow-[4px_4px_0px_0px_rgba(26,26,26,1)]"
              >
                <item.icon className="h-5 w-5" />
                {item.label}
              </Link>
            ))}
          </nav>
        </div>
      </aside>
      <main className="min-h-screen pt-20 lg:ml-64">
        <div className="p-4 md:p-6 lg:p-8">{children}</div>
      </main>
    </div>
  );
}
