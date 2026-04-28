"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Home,
  Building2,
  CreditCard,
  MessageSquare,
  Settings,
  FileText,
  Menu,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";

export function TenantSidebar() {
  const pathname = usePathname();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const navItems = [
    { href: "/dashboard/tenant", label: "Dashboard", icon: Home },
    { href: "/dashboard/tenant/payments", label: "Payments", icon: CreditCard },
    { href: "/dashboard/tenant/lease", label: "My Lease", icon: FileText },
    { href: "/properties", label: "Browse Properties", icon: Building2 },
    { href: "/dashboard/tenant/rate-whistleblower", label: "Rate Whistleblower", icon: MessageSquare },
    { href: "/messages", label: "Messages", icon: MessageSquare, badge: 2 },
    { href: "/dashboard/tenant/settings", label: "Settings", icon: Settings },
  ];

  return (
    <>
      {/* Mobile Menu Button */}
      <button
        onClick={() => setSidebarOpen(!sidebarOpen)}
        className="fixed bottom-6 right-6 z-50 flex h-14 w-14 items-center justify-center border-3 border-foreground bg-primary shadow-[4px_4px_0px_0px_rgba(26,26,26,1)] lg:hidden"
      >
        {sidebarOpen ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
      </button>

      {/* Mobile Overlay */}
      {sidebarOpen && (
        <button
          type="button"
          aria-label="Close sidebar"
          className="fixed inset-0 z-40 bg-foreground/50 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`fixed left-0 top-0 z-40 h-screen w-64 border-r-3 border-foreground bg-card pt-20 transition-transform lg:translate-x-0 ${sidebarOpen ? "translate-x-0" : "-translate-x-full"}`}
      >
        <div className="flex h-full flex-col px-4 py-6">
          <div className="mb-8 border-3 border-foreground bg-secondary p-4 shadow-[4px_4px_0px_0px_rgba(26,26,26,1)]">
            <p className="text-sm font-medium text-foreground">Logged in as</p>
            <p className="text-lg font-bold text-foreground">Ngozi Adekunle</p>
            <p className="text-sm text-muted-foreground">Tenant</p>
          </div>

          <nav className="flex-1 space-y-2">
            {navItems.map((item) => {
              const isActive = pathname === item.href;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`flex items-center gap-3 border-3 border-foreground p-3 font-bold transition-all ${
                    isActive
                      ? "bg-primary shadow-[4px_4px_0px_0px_rgba(26,26,26,1)]"
                      : "bg-card hover:bg-muted hover:shadow-[4px_4px_0px_0px_rgba(26,26,26,1)]"
                  }`}
                  onClick={() => setSidebarOpen(false)}
                >
                  <item.icon className="h-5 w-5" />
                  {item.label}
                  {item.badge && (
                    <span className="ml-auto flex h-6 w-6 items-center justify-center border-2 border-foreground bg-destructive text-xs font-bold text-destructive-foreground">
                      {item.badge}
                    </span>
                  )}
                </Link>
              );
            })}
          </nav>
        </div>
      </aside>
    </>
  );
}
