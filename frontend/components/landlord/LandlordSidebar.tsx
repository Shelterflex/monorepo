"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Home,
  Building2,
  Users,
  MessageSquare,
  Settings,
  BarChart3,
  DollarSign,
  X,
  Menu,
} from "lucide-react";
import { useState } from "react";

export function LandlordSidebar() {
  const pathname = usePathname();
  const [isOpen, setIsOpen] = useState(false);

  const navItems = [
    { href: "/dashboard/landlord", label: "Dashboard", icon: Home },
    { href: "/dashboard/landlord/properties", label: "My Properties", icon: Building2 },
    { href: "/dashboard/landlord/tenants", label: "My Tenants", icon: Users },
    { href: "/dashboard/landlord/payouts", label: "Payout Schedule", icon: DollarSign },
    { href: "/dashboard/landlord/analytics", label: "Analytics", icon: BarChart3 },
    { href: "/messages", label: "Messages", icon: MessageSquare, badge: 3 },
    { href: "/dashboard/landlord/settings", label: "Settings", icon: Settings },
  ];

  return (
    <>
      {/* Mobile Menu Button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="fixed bottom-6 right-6 z-50 flex h-14 w-14 items-center justify-center border-3 border-foreground bg-primary shadow-[4px_4px_0px_0px_rgba(26,26,26,1)] lg:hidden"
      >
        {isOpen ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
      </button>

      {/* Mobile Overlay */}
      {isOpen && (
        <button
          type="button"
          aria-label="Close sidebar"
          className="fixed inset-0 z-40 bg-foreground/50 lg:hidden"
          onClick={() => setIsOpen(false)}
        />
      )}

      <aside
        className={`fixed left-0 top-0 z-40 h-screen w-64 border-r-3 border-foreground bg-card pt-20 transition-transform lg:translate-x-0 ${isOpen ? "translate-x-0" : "-translate-x-full"}`}
      >
        <div className="flex h-full flex-col px-4 py-6">
          <div className="mb-8 border-3 border-foreground bg-accent p-4 shadow-[4px_4px_0px_0px_rgba(26,26,26,1)]">
            <p className="text-sm font-medium text-foreground">Logged in as</p>
            <p className="text-lg font-bold text-foreground">Chief Okonkwo</p>
            <p className="text-sm text-muted-foreground">Landlord</p>
          </div>

          <nav className="flex-1 space-y-2">
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive = pathname === item.href;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`flex items-center gap-3 border-3 border-foreground p-3 font-bold transition-all shadow-[4px_4px_0px_0px_rgba(26,26,26,1)] hover:translate-x-0.5 hover:translate-y-0.5 hover:shadow-[2px_2px_0px_0px_rgba(26,26,26,1)] ${
                    isActive ? "bg-primary" : "bg-card hover:bg-muted"
                  }`}
                  onClick={() => setIsOpen(false)}
                >
                  <Icon className="h-5 w-5" />
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
