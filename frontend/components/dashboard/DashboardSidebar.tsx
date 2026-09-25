"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useUnreadMessageCount } from "@/hooks/useUnreadMessageCount";
import {
  Home,
  Building2,
  CreditCard,
  MessageSquare,
  Settings,
  FileText,
  ShieldCheck,
  Gauge,
  DollarSign,
  Users,
  Plus,
  Menu,
  X,
  Heart,
} from "lucide-react";

type Role = "tenant" | "landlord" | "inspector" | "whistleblower";

interface NavItem {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  badge?: React.ReactNode;
  footer?: boolean;
}

export interface UserInfo {
  name: string;
  roleLabel: string;
  extra?: React.ReactNode;
}

interface DashboardSidebarProps {
  role: Role;
  userInfo: UserInfo;
}

const NAV_ITEMS: Record<Role, NavItem[]> = {
  tenant: [
    { href: "/dashboard/tenant", label: "Dashboard", icon: Home },
    { href: "/dashboard/tenant/payments", label: "Payments", icon: CreditCard },
    {
      href: "/dashboard/tenant/credit-score",
      label: "Credit Score",
      icon: Gauge,
    },
    { href: "/dashboard/tenant/lease", label: "My Lease", icon: FileText },
    {
      href: "/dashboard/tenant/vault",
      label: "Document Vault",
      icon: ShieldCheck,
    },
    { href: "/properties", label: "Browse Properties", icon: Building2 },
    {
      href: "/properties/saved",
      label: "Saved Properties",
      icon: Heart,
    },
    {
      href: "/dashboard/tenant/rate-whistleblower",
      label: "Rate Whistleblower",
      icon: MessageSquare,
    },
    {
      href: "/messages",
      label: "Messages",
      icon: MessageSquare,
    },
    { href: "/dashboard/tenant/settings", label: "Settings", icon: Settings },
  ],
  landlord: [
    { href: "/dashboard/landlord", label: "Dashboard", icon: Home },
    {
      href: "/dashboard/landlord/properties",
      label: "My Properties",
      icon: Building2,
    },
    { href: "/dashboard/landlord/tenants", label: "My Tenants", icon: Users },
    {
      href: "/dashboard/landlord/payouts",
      label: "Payout Schedule",
      icon: DollarSign,
    },
    {
      href: "/messages",
      label: "Messages",
      icon: MessageSquare,
    },
    { href: "/dashboard/landlord/settings", label: "Settings", icon: Settings },
  ],
  inspector: [
    { href: "/dashboard/inspector", label: "Job Board", icon: Building2 },
    {
      href: "/dashboard/inspector/earnings",
      label: "Earnings",
      icon: DollarSign,
    },
    { href: "/", label: "Back to Home", icon: Home, footer: true },
  ],
  whistleblower: [
    { href: "/whistleblower/dashboard", label: "Dashboard", icon: Home },
    { href: "/whistleblower/report", label: "Report Apartment", icon: Plus },
    { href: "/whistleblower/earnings", label: "Earnings", icon: DollarSign },
  ],
};

const ROLE_CONFIG: Record<Role, { cardBg: string; cardLabel: string }> = {
  tenant: { cardBg: "bg-secondary", cardLabel: "Logged in as" },
  landlord: { cardBg: "bg-accent", cardLabel: "Logged in as" },
  inspector: { cardBg: "bg-accent", cardLabel: "Logged in as" },
  whistleblower: { cardBg: "bg-secondary", cardLabel: "Whistleblower" },
};

// These root paths only highlight when matched exactly, not on sub-paths.
const EXACT_MATCH_PATHS = [
  "/dashboard/tenant",
  "/dashboard/landlord",
  "/dashboard/inspector",
  "/whistleblower/dashboard",
  "/",
  "/properties",
  "/messages",
];

function isNavItemActive(href: string, pathname: string): boolean {
  if (pathname === href) return true;
  if (EXACT_MATCH_PATHS.includes(href)) return false;
  return pathname.startsWith(href + "/");
}

export function DashboardSidebar({ role, userInfo }: DashboardSidebarProps) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const sidebarRef = useRef<HTMLElement>(null);
  const pathname = usePathname();
  const { cardBg, cardLabel } = ROLE_CONFIG[role];
  const isInspector = role === "inspector";
  const { unreadCount } = useUnreadMessageCount();

  const withMessageBadge = (item: NavItem): NavItem =>
    item.href === "/messages" && unreadCount > 0
      ? {
          ...item,
          badge: (
            <span className="ml-auto flex h-6 w-6 items-center justify-center border-2 border-foreground bg-destructive text-xs font-bold text-destructive-foreground">
              {unreadCount}
            </span>
          ),
        }
      : item;

  const mainItems = NAV_ITEMS[role]
    .filter((item) => !item.footer)
    .map(withMessageBadge);
  const footerItems = NAV_ITEMS[role].filter((item) => item.footer);

  useEffect(() => {
    if (!open) return;

    const sidebar = sidebarRef.current;
    const focusable = sidebar?.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])',
    );
    const first = focusable?.[0];
    const last = focusable?.[focusable.length - 1];
    first?.focus();

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
        return;
      }

      if (event.key !== "Tab" || !first || !last) return;

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open]);

  function closeSidebar() {
    setOpen(false);
    triggerRef.current?.focus();
  }

  function navLinkClass(href: string): string {
    const active = isNavItemActive(href, pathname);
    if (isInspector) {
      return active
        ? "flex items-center gap-3 rounded-lg border-2 border-foreground bg-primary px-4 py-3 font-bold text-foreground shadow-[2px_2px_0px_0px_rgba(26,26,26,1)] outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
        : "flex items-center gap-3 rounded-lg border-2 border-transparent px-4 py-3 text-muted-foreground outline-none transition-colors hover:border-foreground hover:bg-muted focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50";
    }
    return active
      ? "flex items-center gap-3 border-3 border-foreground bg-primary p-3 font-bold outline-none shadow-[4px_4px_0px_0px_rgba(26,26,26,1)] focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
      : "flex items-center gap-3 border-3 border-foreground bg-card p-3 font-bold outline-none transition-all hover:bg-muted hover:shadow-[4px_4px_0px_0px_rgba(26,26,26,1)] focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50";
  }

  return (
    <>
      {/* Mobile toggle button */}
      <button
        ref={triggerRef}
        type="button"
        aria-label={
          open ? "Close dashboard navigation" : "Open dashboard navigation"
        }
        aria-expanded={open}
        aria-controls="dashboard-sidebar"
        onClick={() => setOpen(!open)}
        className="fixed bottom-6 right-6 z-50 flex h-14 w-14 items-center justify-center border-3 border-foreground bg-primary outline-none shadow-[4px_4px_0px_0px_rgba(26,26,26,1)] focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 lg:hidden"
      >
        {open ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
      </button>

      {/* Mobile overlay */}
      {open && (
        <button
          type="button"
          aria-label="Close sidebar"
          className="fixed inset-0 z-40 bg-foreground/50 lg:hidden"
          onClick={closeSidebar}
        />
      )}

      {/* Sidebar */}
      <aside
        id="dashboard-sidebar"
        ref={sidebarRef}
        aria-label={`${userInfo.roleLabel} dashboard navigation`}
        className={`fixed left-0 rtl:right-0 rtl:left-auto top-0 z-40 h-screen w-64 border-r-3 rtl:border-r-0 rtl:border-l-3 border-foreground bg-card pt-20 transition-transform lg:translate-x-0 ${open ? "translate-x-0" : "-translate-x-full rtl:translate-x-full"}`}
      >
        <div className="flex h-full flex-col px-4 py-6">
          {/* User card */}
          <div
            className={`mb-8 border-3 border-foreground ${cardBg} p-4 shadow-[4px_4px_0px_0px_rgba(26,26,26,1)]`}
          >
            <p className="text-sm font-medium text-foreground">{cardLabel}</p>
            <p className="text-lg font-bold text-foreground">{userInfo.name}</p>
            {userInfo.extra ?? (
              <p className="text-sm text-muted-foreground">
                {userInfo.roleLabel}
              </p>
            )}
          </div>

          {/* Nav */}
          <nav className="flex-1 space-y-2">
            {mainItems.map((item) => {
              const Icon = item.icon;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={navLinkClass(item.href)}
                  aria-current={
                    isNavItemActive(item.href, pathname) ? "page" : undefined
                  }
                  onClick={closeSidebar}
                >
                  <Icon className="h-5 w-5" />
                  {item.label}
                  {item.badge}
                </Link>
              );
            })}
          </nav>

          {/* Footer items (e.g. inspector's "Back to Home") */}
          {footerItems.length > 0 && (
            <div className="mt-auto pt-6">
              {footerItems.map((item) => {
                const Icon = item.icon;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={navLinkClass(item.href)}
                    aria-current={
                      isNavItemActive(item.href, pathname) ? "page" : undefined
                    }
                    onClick={closeSidebar}
                  >
                    <Icon className="h-5 w-5" />
                    {item.label}
                  </Link>
                );
              })}
            </div>
          )}
        </div>
      </aside>
    </>
  );
}
