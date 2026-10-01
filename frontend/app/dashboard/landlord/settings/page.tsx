"use client";

import { useState, useEffect, type ChangeEvent } from "react";
import Link from "next/link";
import {
  Home,
  Building2,
  Users,
  MessageSquare,
  Settings,
  User,
  Bell,
  Shield,
  CreditCard,
  Mail,
  Phone,
  MapPin,
  Save,
  Eye,
  EyeOff,
  Loader2,
  Check,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { DashboardHeader } from "@/components/dashboard-header";
import { LandlordSidebar } from "@/components/landlord/LandlordSidebar";
import { apiFetch } from "@/lib/api";
import {
  listPayouts,
  type LandlordPayout,
  formatCurrency,
  formatPayoutDate,
  PAYOUT_STATUS_LABELS,
} from "@/lib/landlordPayoutApi";

export default function LandlordSettingsPage() {
  const [activeTab, setActiveTab] = useState<
    "profile" | "notifications" | "security" | "payment"
  >("profile");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [payouts, setPayouts] = useState<LandlordPayout[]>([]);
  const [payoutsLoading, setPayoutsLoading] = useState(true);
  const [payoutsError, setPayoutsError] = useState<string | null>(null);
  const [payoutPage, setPayoutPage] = useState(1);
  const [payoutTotalPages, setPayoutTotalPages] = useState(1);
  const [settings, setSettings] = useState({
    profile: {
      fullName: "",
      email: "",
      companyName: "",
      phone: "",
      address: "",
    },
    notifications: {
      newInquiries: true,
      paymentUpdates: true,
      propertyViews: false,
      marketingTips: false,
      payoutUpdates: true, // Ensuring compatibility if needed
    },
    payout: {
      bankName: "",
      accountNumber: "",
      accountName: "",
    }
  });

  useEffect(() => {
    const fetchSettings = async () => {
      try {
        const data = await apiFetch<any>("/api/landlord/settings");
        setSettings(data);
      } catch (error) {
        console.error("Failed to fetch settings:", error);
      } finally {
        setLoading(false);
      }
    };
    fetchSettings();
  }, []);

  useEffect(() => {
    const fetchPayouts = async () => {
      setPayoutsLoading(true);
      setPayoutsError(null);
      try {
        const result = await listPayouts({ page: payoutPage, pageSize: 10 });
        setPayouts(result.data);
        setPayoutTotalPages(result.pagination.totalPages);
      } catch (err: any) {
        setPayoutsError(err?.message || "Failed to load payment history");
      } finally {
        setPayoutsLoading(false);
      }
    };
    fetchPayouts();
  }, [payoutPage]);

  const handleSave = async () => {
    setSaving(true);
    try {
      await apiFetch("/api/landlord/settings", {
        method: "PATCH",
        body: JSON.stringify(settings)
      });
    } catch (error) {
      console.error("Failed to save settings:", error);
    } finally {
      setSaving(false);
    }
  };

  const tabs = [
    { id: "profile", label: "Profile", icon: User },
    { id: "notifications", label: "Notifications", icon: Bell },
    { id: "security", label: "Security", icon: Shield },
    { id: "payment", label: "Payment", icon: CreditCard },
  ];

  return (
    <div className="min-h-screen bg-background">
      <DashboardHeader />
      <LandlordSidebar />

      {/* Main Content */}
      <main id="main-content" className="ml-64 min-h-screen pt-20">
        <div className="p-8">
          {/* Header */}
          <div className="mb-8">
            <h1 className="text-3xl font-bold text-foreground">Settings</h1>
            <p className="mt-1 text-muted-foreground">
              Manage your account preferences
            </p>
          </div>

          {/* Tabs */}
          <div className="mb-6 flex gap-2">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as typeof activeTab)}
                className={`flex items-center gap-2 border-3 border-foreground px-4 py-3 font-bold transition-all ${
                  activeTab === tab.id
                    ? "bg-foreground text-background shadow-[4px_4px_0px_0px_rgba(26,26,26,1)]"
                    : "bg-card hover:bg-muted"
                }`}
              >
                <tab.icon className="h-4 w-4" />
                {tab.label}
              </button>
            ))}
          </div>

          {/* Profile Tab */}
          {activeTab === "profile" && (
            <Card className="border-3 border-foreground p-6 shadow-[4px_4px_0px_0px_rgba(26,26,26,1)]">
              <h2 className="mb-6 text-xl font-bold">Profile Information</h2>

              <div className="grid gap-6 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="full-name" className="font-bold">Full Name</Label>
                  <Input
                    id="full-name"
                    value={settings.profile.fullName}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSettings({ ...settings, profile: { ...settings.profile, fullName: e.target.value } })}
                    className="border-3 border-foreground bg-background py-5 shadow-[3px_3px_0px_0px_rgba(26,26,26,1)]"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="company-name" className="font-bold">Company Name</Label>
                  <Input
                    id="company-name"
                    value={settings.profile.companyName}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSettings({ ...settings, profile: { ...settings.profile, companyName: e.target.value } })}
                    className="border-3 border-foreground bg-background py-5 shadow-[3px_3px_0px_0px_rgba(26,26,26,1)]"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="email" className="font-bold">Email Address</Label>
                  <div className="relative">
                    <Mail className="absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      id="email"
                      type="email"
                      disabled
                      value={settings.profile.email}
                      className="border-3 border-foreground bg-muted py-5 pl-12 opacity-70"
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="phone" className="font-bold">Phone Number</Label>
                  <div className="relative">
                    <Phone className="absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      id="phone"
                      value={settings.profile.phone}
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSettings({ ...settings, profile: { ...settings.profile, phone: e.target.value } })}
                      className="border-3 border-foreground bg-background py-5 pl-12 shadow-[3px_3px_0px_0px_rgba(26,26,26,1)]"
                    />
                  </div>
                </div>
                <div className="space-y-2 md:col-span-2">
                  <Label htmlFor="address" className="font-bold">Address</Label>
                  <div className="relative">
                    <MapPin className="absolute left-4 top-4 h-5 w-5 text-muted-foreground" />
                    <Input
                      id="address"
                      value={settings.profile.address}
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSettings({ ...settings, profile: { ...settings.profile, address: e.target.value } })}
                      className="border-3 border-foreground bg-background py-5 pl-12 shadow-[3px_3px_0px_0px_rgba(26,26,26,1)]"
                    />
                  </div>
                </div>
              </div>

              <div className="mt-6 flex justify-end">
                <Button 
                  onClick={handleSave}
                  disabled={saving}
                  className="border-3 border-foreground bg-primary px-6 py-5 font-bold shadow-[4px_4px_0px_0px_rgba(26,26,26,1)] transition-all hover:translate-x-0.5 hover:translate-y-0.5 hover:shadow-[2px_2px_0px_0px_rgba(26,26,26,1)]"
                >
                  {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                  {saving ? "Saving..." : "Save Changes"}
                </Button>
              </div>
            </Card>
          )}

          {/* Notifications Tab */}
          {activeTab === "notifications" && (
            <Card className="border-3 border-foreground p-6 shadow-[4px_4px_0px_0px_rgba(26,26,26,1)]">
              <h2 className="mb-6 text-xl font-bold">
                Notification Preferences
              </h2>

              <div className="space-y-6">
                {[
                  {
                    id: "newInquiries",
                    title: "New Inquiries",
                    description:
                      "Get notified when tenants inquire about your properties",
                  },
                  {
                    id: "paymentUpdates",
                    title: "Payment Updates",
                    description: "Get notified about tenant payment status",
                  },
                  {
                    id: "propertyViews",
                    title: "Property Views",
                    description:
                      "Weekly summary of property views and engagement",
                  },
                  {
                    id: "marketingTips",
                    title: "Marketing Tips",
                    description: "Tips to improve your property listings",
                  },
                ].map((item) => (
                  <div
                    key={item.id}
                    className="flex items-center justify-between border-b-2 border-foreground/10 pb-4 last:border-0"
                  >
                    <div>
                      <p className="font-bold">{item.title}</p>
                      <p className="text-sm text-muted-foreground">
                        {item.description}
                      </p>
                    </div>
                    <Switch 
                      checked={(settings.notifications as any)[item.id]} 
                      onCheckedChange={(checked: boolean) => {
                        const newNotifications = { ...settings.notifications, [item.id]: checked };
                        setSettings({ ...settings, notifications: newNotifications });
                        // Optionally auto-save on switch? For now, let's just update state.
                      }}
                    />
                  </div>
                ))}
              </div>

              <div className="mt-6 flex justify-end">
                <Button 
                  onClick={handleSave}
                  disabled={saving}
                  className="border-3 border-foreground bg-primary px-6 py-5 font-bold shadow-[4px_4px_0px_0px_rgba(26,26,26,1)]"
                >
                  {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                  {saving ? "Saving..." : "Save Preferences"}
                </Button>
              </div>
            </Card>
          )}

          {/* Security Tab */}
          {activeTab === "security" && (
            <Card className="border-3 border-foreground p-6 shadow-[4px_4px_0px_0px_rgba(26,26,26,1)]">
              <h2 className="mb-6 text-xl font-bold">Security Settings</h2>

              <div className="space-y-6">
                <div className="space-y-4">
                  <h3 className="font-bold">Change Password</h3>
                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor="current-password">Current Password</Label>
                      <div className="relative">
                        <Input
                          id="current-password"
                          type={showPassword ? "text" : "password"}
                          className="border-3 border-foreground bg-background py-5 pr-12 shadow-[3px_3px_0px_0px_rgba(26,26,26,1)]"
                        />
                        <button
                          type="button"
                          onClick={() => setShowPassword(!showPassword)}
                          className="absolute right-4 top-1/2 -translate-y-1/2"
                          aria-label={showPassword ? "Hide current password" : "Show current password"}
                          aria-pressed={showPassword}
                        >
                          {showPassword ? (
                            <EyeOff className="h-5 w-5" />
                          ) : (
                            <Eye className="h-5 w-5" />
                          )}
                        </button>
                      </div>
                    </div>
                    <div />
                    <div className="space-y-2">
                      <Label htmlFor="new-password">New Password</Label>
                      <Input
                        id="new-password"
                        type="password"
                        className="border-3 border-foreground bg-background py-5 shadow-[3px_3px_0px_0px_rgba(26,26,26,1)]"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="confirm-new-password">Confirm New Password</Label>
                      <Input
                        id="confirm-new-password"
                        type="password"
                        className="border-3 border-foreground bg-background py-5 shadow-[3px_3px_0px_0px_rgba(26,26,26,1)]"
                      />
                    </div>
                  </div>
                  <Button className="border-3 border-foreground bg-secondary font-bold shadow-[4px_4px_0px_0px_rgba(26,26,26,1)]">
                    Update Password
                  </Button>
                </div>

                <div className="border-t-2 border-foreground pt-6">
                  <h3 className="font-bold mb-4">Two-Factor Authentication</h3>
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-muted-foreground">
                        Add an extra layer of security to your account
                      </p>
                    </div>
                    <Switch />
                  </div>
                </div>
              </div>
            </Card>
          )}

          {/* Payment Tab */}
          {activeTab === "payment" && (
            <Card className="border-3 border-foreground p-6 shadow-[4px_4px_0px_0px_rgba(26,26,26,1)]">
              <h2 className="mb-6 text-xl font-bold">Payment Settings</h2>

              <div className="space-y-6">
                <div>
                  <h3 className="font-bold mb-4">
                    Bank Account for Rent Payments
                  </h3>
                  <div className="border-3 border-foreground bg-card p-6 shadow-[3px_3px_0px_0px_rgba(26,26,26,1)]">
                    <div className="grid gap-6 md:grid-cols-2">
                      <div className="space-y-2">
                        <Label htmlFor="bank-name" className="font-bold">Bank Name</Label>
                        <Input
                          id="bank-name"
                          value={settings.payout.bankName}
                          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSettings({ ...settings, payout: { ...settings.payout, bankName: e.target.value } })}
                          className="border-3 border-foreground bg-background py-5 shadow-[3px_3px_0px_0px_rgba(26,26,26,1)]"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="account-name" className="font-bold">Account Name</Label>
                        <Input
                          id="account-name"
                          value={settings.payout.accountName}
                          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSettings({ ...settings, payout: { ...settings.payout, accountName: e.target.value } })}
                          className="border-3 border-foreground bg-background py-5 shadow-[3px_3px_0px_0px_rgba(26,26,26,1)]"
                        />
                      </div>
                      <div className="space-y-2 md:col-span-2">
                        <Label htmlFor="account-number" className="font-bold">Account Number</Label>
                        <Input
                          id="account-number"
                          value={settings.payout.accountNumber}
                          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSettings({ ...settings, payout: { ...settings.payout, accountNumber: e.target.value } })}
                          className="border-3 border-foreground bg-background py-5 shadow-[3px_3px_0px_0px_rgba(26,26,26,1)]"
                        />
                      </div>
                    </div>
                  </div>
                  <div className="mt-6 flex justify-end">
                    <Button 
                      onClick={handleSave}
                      disabled={saving}
                      className="border-3 border-foreground bg-primary px-6 py-5 font-bold shadow-[4px_4px_0px_0px_rgba(26,26,26,1)]"
                    >
                      {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                      {saving ? "Saving..." : "Update Bank Details"}
                    </Button>
                  </div>
                </div>

                <div className="border-t-2 border-foreground pt-6">
                  <h3 className="font-bold mb-4">Payment History</h3>
                  {payoutsLoading ? (
                    <div className="flex items-center justify-center py-8">
                      <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                    </div>
                  ) : payoutsError ? (
                    <p className="text-sm text-destructive py-4">{payoutsError}</p>
                  ) : payouts.length === 0 ? (
                    <p className="text-sm text-muted-foreground py-4">No payment history yet.</p>
                  ) : (
                    <>
                      <div className="space-y-3">
                        {payouts.map((payout) => (
                          <div
                            key={payout.id}
                            className="flex items-center justify-between border-b border-foreground/10 pb-3"
                          >
                            <div>
                              <span className="text-muted-foreground">
                                {formatPayoutDate(payout.periodStart)} - {formatPayoutDate(payout.periodEnd)}
                              </span>
                              <p className="text-xs text-muted-foreground">{payout.propertyName}</p>
                            </div>
                            <span className="font-bold">{formatCurrency(payout.netAmount, payout.currency)}</span>
                            <span className={`border-2 border-foreground px-2 py-0.5 text-sm font-bold ${
                              payout.status === "completed"
                                ? "bg-secondary"
                                : payout.status === "failed"
                                  ? "bg-destructive/20 text-destructive"
                                  : payout.status === "delayed"
                                    ? "bg-destructive/10 text-destructive"
                                    : "bg-muted"
                            }`}>
                              {PAYOUT_STATUS_LABELS[payout.status] || payout.status}
                            </span>
                          </div>
                        ))}
                      </div>
                      {payoutTotalPages > 1 && (
                        <div className="mt-4 flex items-center justify-between">
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={payoutPage <= 1}
                            onClick={() => setPayoutPage((p) => p - 1)}
                            className="border-2 border-foreground"
                          >
                            Previous
                          </Button>
                          <span className="text-sm text-muted-foreground">
                            Page {payoutPage} of {payoutTotalPages}
                          </span>
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={payoutPage >= payoutTotalPages}
                            onClick={() => setPayoutPage((p) => p + 1)}
                            className="border-2 border-foreground"
                          >
                            Next
                          </Button>
                        </div>
                      )}
                    </>
                  )}
                </div>
              </div>
            </Card>
          )}
        </div>
      </main>
    </div>
  );
}
