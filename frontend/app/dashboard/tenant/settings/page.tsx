"use client"

import { useState } from "react"
import Link from "next/link"
import {
  Home,
  Building2,
  CreditCard,
  MessageSquare,
  Settings,
  User,
  Bell,
  Shield,
  FileText,
  Mail,
  Phone,
  MapPin,
  Save,
  Eye,
  EyeOff,
  Wallet,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { DashboardHeader } from "@/components/dashboard-header"

export default function TenantSettingsPage() {
  const [activeTab, setActiveTab] = useState<"profile" | "notifications" | "security" | "payment">("profile")
  const [showPassword, setShowPassword] = useState(false)

  const tabs = [
    { id: "profile", label: "Profile", icon: User },
    { id: "notifications", label: "Notifications", icon: Bell },
    { id: "security", label: "Security", icon: Shield },
    { id: "payment", label: "Payment", icon: CreditCard },
  ]

  return (
    <div className="min-h-screen bg-background">
      <DashboardHeader />

      {/* Sidebar */}
      <aside className="fixed left-0 top-0 z-40 h-screen w-64 border-r-3 border-foreground bg-card pt-20">
        <div className="flex h-full flex-col px-4 py-6">
          <div className="mb-8 border-3 border-foreground bg-secondary p-4 shadow-[4px_4px_0px_0px_rgba(26,26,26,1)]">
            <p className="text-sm font-medium text-foreground">Logged in as</p>
            <p className="text-lg font-bold text-foreground">Ngozi Adekunle</p>
            <p className="text-sm text-muted-foreground">Tenant</p>
          </div>

          <nav className="flex-1 space-y-2">
            <Link
              href="/dashboard/tenant"
              className="flex items-center gap-3 border-3 border-foreground bg-card p-3 font-bold transition-all hover:bg-muted hover:shadow-[4px_4px_0px_0px_rgba(26,26,26,1)]"
            >
              <Home className="h-5 w-5" />
              Dashboard
            </Link>
            <Link
              href="/dashboard/tenant/payments"
              className="flex items-center gap-3 border-3 border-foreground bg-card p-3 font-bold transition-all hover:bg-muted hover:shadow-[4px_4px_0px_0px_rgba(26,26,26,1)]"
            >
              <CreditCard className="h-5 w-5" />
              Payments
            </Link>
            <Link
              href="/dashboard/tenant/lease"
              className="flex items-center gap-3 border-3 border-foreground bg-card p-3 font-bold transition-all hover:bg-muted hover:shadow-[4px_4px_0px_0px_rgba(26,26,26,1)]"
            >
              <FileText className="h-5 w-5" />
              My Lease
            </Link>
            <Link
              href="/properties"
              className="flex items-center gap-3 border-3 border-foreground bg-card p-3 font-bold transition-all hover:bg-muted hover:shadow-[4px_4px_0px_0px_rgba(26,26,26,1)]"
            >
              <Building2 className="h-5 w-5" />
              Browse Properties
            </Link>
            <Link
              href="/messages"
              className="flex items-center gap-3 border-3 border-foreground bg-card p-3 font-bold transition-all hover:bg-muted hover:shadow-[4px_4px_0px_0px_rgba(26,26,26,1)]"
            >
              <MessageSquare className="h-5 w-5" />
              Messages
              <span className="ml-auto flex h-6 w-6 items-center justify-center border-2 border-foreground bg-destructive text-xs font-bold text-destructive-foreground">
                2
              </span>
            </Link>
            <Link
              href="/dashboard/tenant/settings"
              className="flex items-center gap-3 border-3 border-foreground bg-primary p-3 font-bold shadow-[4px_4px_0px_0px_rgba(26,26,26,1)]"
            >
              <Settings className="h-5 w-5" />
              Settings
            </Link>
          </nav>
        </div>
      </aside>

      {/* Main Content */}
      <main className="ml-64 min-h-screen pt-20">
        <div className="p-8">
          {/* Header */}
          <div className="mb-8">
            <h1 className="text-3xl font-bold text-foreground">Settings</h1>
            <p className="mt-1 text-muted-foreground">Manage your account preferences</p>
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
              
              <div className="mb-8 flex items-center gap-6">
                <div className="flex h-24 w-24 items-center justify-center border-3 border-foreground bg-secondary text-3xl font-bold">
                  NA
                </div>
                <div>
                  <Button variant="outline" className="border-3 border-foreground bg-transparent font-bold">
                    Change Photo
                  </Button>
                  <p className="mt-2 text-sm text-muted-foreground">JPG, PNG or GIF. Max 2MB</p>
                </div>
              </div>

              <div className="grid gap-6 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="full-name" className="font-bold">Full Name</Label>
                  <Input
                    id="full-name"
                    defaultValue="Ngozi Adekunle"
                    className="border-3 border-foreground bg-background py-5 shadow-[3px_3px_0px_0px_rgba(26,26,26,1)]"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="occupation" className="font-bold">Occupation</Label>
                  <Input
                    id="occupation"
                    defaultValue="Software Engineer"
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
                      defaultValue="ngozi.a@email.com"
                      className="border-3 border-foreground bg-background py-5 pl-12 shadow-[3px_3px_0px_0px_rgba(26,26,26,1)]"
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="phone" className="font-bold">Phone Number</Label>
                  <div className="relative">
                    <Phone className="absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      id="phone"
                      defaultValue="+234 801 234 5678"
                      className="border-3 border-foreground bg-background py-5 pl-12 shadow-[3px_3px_0px_0px_rgba(26,26,26,1)]"
                    />
                  </div>
                </div>
                <div className="space-y-2 md:col-span-2">
                  <Label htmlFor="address" className="font-bold">Current Address</Label>
                  <div className="relative">
                    <MapPin className="absolute left-4 top-4 h-5 w-5 text-muted-foreground" />
                    <Input
                      id="address"
                      defaultValue="15 Admiralty Way, Lekki Phase 1, Lagos"
                      className="border-3 border-foreground bg-background py-5 pl-12 shadow-[3px_3px_0px_0px_rgba(26,26,26,1)]"
                    />
                  </div>
                </div>
              </div>

              <div className="mt-6 flex justify-end">
                <Button className="border-3 border-foreground bg-primary px-6 py-5 font-bold shadow-[4px_4px_0px_0px_rgba(26,26,26,1)] transition-all hover:translate-x-0.5 hover:translate-y-0.5 hover:shadow-[2px_2px_0px_0px_rgba(26,26,26,1)]">
                  <Save className="mr-2 h-4 w-4" />
                  Save Changes
                </Button>
              </div>
            </Card>
          )}

          {/* Notifications Tab */}
          {activeTab === "notifications" && (
            <Card className="border-3 border-foreground p-6 shadow-[4px_4px_0px_0px_rgba(26,26,26,1)]">
              <h2 className="mb-6 text-xl font-bold">Notification Preferences</h2>
              
              <div className="space-y-6">
                {[
                  { title: "Payment Reminders", description: "Get notified before your payment is due", defaultChecked: true },
                  { title: "Payment Confirmations", description: "Get notified when payments are processed", defaultChecked: true },
                  { title: "Lease Updates", description: "Get notified about lease renewals and changes", defaultChecked: true },
                  { title: "Messages", description: "Get notified when you receive new messages", defaultChecked: true },
                  { title: "Property Updates", description: "Get notified about updates to saved properties", defaultChecked: false },
                  { title: "Promotional Offers", description: "Get notified about special offers and discounts", defaultChecked: false },
                ].map((item) => (
                  <div key={item.title} className="flex items-center justify-between border-b-2 border-foreground/10 pb-4 last:border-0">
                    <div>
                      <p className="font-bold">{item.title}</p>
                      <p className="text-sm text-muted-foreground">{item.description}</p>
                    </div>
                    <Switch defaultChecked={item.defaultChecked} />
                  </div>
                ))}
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
                          {showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
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
                      <p className="text-muted-foreground">Add an extra layer of security to your account</p>
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
                {/* Linked Bank Account */}
                <div>
                  <h3 className="font-bold mb-4">Linked Bank Account (Auto-debit)</h3>
                  <div className="border-3 border-foreground bg-muted p-4">
                    <div className="grid gap-4 md:grid-cols-3">
                      <div>
                        <p className="text-sm text-muted-foreground">Bank Name</p>
                        <p className="font-bold">GTBank</p>
                      </div>
                      <div>
                        <p className="text-sm text-muted-foreground">Account Number</p>
                        <p className="font-bold">••••••1234</p>
                      </div>
                      <div>
                        <p className="text-sm text-muted-foreground">Account Name</p>
                        <p className="font-bold">Ngozi Adekunle</p>
                      </div>
                    </div>
                  </div>
                  <Button variant="outline" className="mt-4 border-3 border-foreground bg-transparent font-bold">
                    Update Bank Details
                  </Button>
                </div>

                {/* Auto-pay Settings */}
                <div className="border-t-2 border-foreground pt-6">
                  <h3 className="font-bold mb-4">Auto-pay Settings</h3>
                  <div className="space-y-4">
                    <div className="flex items-center justify-between border-3 border-foreground bg-muted/50 p-4">
                      <div>
                        <p className="font-bold">Enable Auto-pay</p>
                        <p className="text-sm text-muted-foreground">
                          Automatically deduct payments on due date
                        </p>
                      </div>
                      <Switch defaultChecked />
                    </div>
                    <div className="flex items-center justify-between border-3 border-foreground bg-muted/50 p-4">
                      <div>
                        <p className="font-bold">Use Wallet First</p>
                        <p className="text-sm text-muted-foreground">
                          Deduct from wallet balance before bank account
                        </p>
                      </div>
                      <Switch defaultChecked />
                    </div>
                  </div>
                </div>

                {/* Wallet */}
                <div className="border-t-2 border-foreground pt-6">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="font-bold">Wallet Balance</h3>
                    <Link href="/dashboard/tenant/payments">
                      <Button variant="outline" size="sm" className="border-2 border-foreground bg-transparent font-bold">
                        <Wallet className="mr-1 h-4 w-4" />
                        Top Up Wallet
                      </Button>
                    </Link>
                  </div>
                  <div className="border-3 border-foreground bg-primary/10 p-4">
                    <p className="text-sm text-muted-foreground">Wallet Balance</p>
                    <p className="text-2xl font-bold">₦150,000</p>
                  </div>
                </div>
              </div>
            </Card>
          )}
        </div>
      </main>
    </div>
  )
}
