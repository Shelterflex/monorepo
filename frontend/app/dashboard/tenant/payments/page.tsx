"use client"

import { useState } from "react"
import Link from "next/link"
import {
  Home,
  Building2,
  CreditCard,
  MessageSquare,
  Settings,
  Calendar,
  Clock,
  CheckCircle,
  AlertCircle,
  FileText,
  Wallet,
  Plus,
  Receipt,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { DashboardHeader } from "@/components/dashboard-header"
import {
  tenantPastPayments as pastPayments,
  tenantPaymentSchedule as paymentSchedule,
  tenantWalletData as walletData,
} from "@/lib/mockData"

// Wallet balance - checked first before auto-deduction
// (mock data lives in lib/mockData)

export default function TenantPaymentsPage() {
  const [activeTab, setActiveTab] = useState<"upcoming" | "history" | "wallet">("upcoming")
  const [topUpAmount, setTopUpAmount] = useState("")
  const [walletBalance, setWalletBalance] = useState(walletData.balance)

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat("en-NG", {
      style: "currency",
      currency: "NGN",
      minimumFractionDigits: 0,
    }).format(amount)
  }

  const nextPayment = paymentSchedule.find((p) => p.status === "upcoming")

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
              className="flex items-center gap-3 border-3 border-foreground bg-primary p-3 font-bold shadow-[4px_4px_0px_0px_rgba(26,26,26,1)]"
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
              className="flex items-center gap-3 border-3 border-foreground bg-card p-3 font-bold transition-all hover:bg-muted hover:shadow-[4px_4px_0px_0px_rgba(26,26,26,1)]"
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
            <h1 className="text-3xl font-bold text-foreground">Payments</h1>
            <p className="mt-1 text-muted-foreground">Manage your rent payments and wallet</p>
          </div>

          {/* Quick Stats */}
          <div className="mb-8 grid grid-cols-3 gap-4">
            <Card className="border-3 border-foreground p-4 shadow-[4px_4px_0px_0px_rgba(26,26,26,1)]">
              <div className="flex items-center gap-3">
                <div className="flex h-12 w-12 items-center justify-center border-3 border-foreground bg-primary">
                  <Wallet className="h-6 w-6" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Wallet Balance</p>
                  <p className="text-xl font-bold">{formatCurrency(walletBalance)}</p>
                </div>
              </div>
            </Card>
            <Card className="border-3 border-foreground p-4 shadow-[4px_4px_0px_0px_rgba(26,26,26,1)]">
              <div className="flex items-center gap-3">
                <div className="flex h-12 w-12 items-center justify-center border-3 border-foreground bg-secondary">
                  <AlertCircle className="h-6 w-6" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Next Payment</p>
                  <p className="text-xl font-bold">{nextPayment ? formatCurrency(nextPayment.amount) : "N/A"}</p>
                </div>
              </div>
            </Card>
            <Card className="border-3 border-foreground p-4 shadow-[4px_4px_0px_0px_rgba(26,26,26,1)]">
              <div className="flex items-center gap-3">
                <div className="flex h-12 w-12 items-center justify-center border-3 border-foreground bg-accent">
                  <Calendar className="h-6 w-6" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Due Date</p>
                  <p className="text-xl font-bold">{nextPayment ? nextPayment.dueDate : "N/A"}</p>
                </div>
              </div>
            </Card>
          </div>

          {/* Tabs */}
          <div className="mb-6 flex gap-4">
            {[
              { id: "upcoming", label: "Upcoming Payments" },
              { id: "history", label: "Payment History" },
              { id: "wallet", label: "Your Wallet" },
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as typeof activeTab)}
                className={`border-3 border-foreground px-6 py-3 font-bold transition-all ${
                  activeTab === tab.id
                    ? "bg-foreground text-background shadow-[4px_4px_0px_0px_rgba(26,26,26,1)]"
                    : "bg-card hover:bg-muted"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* Upcoming Payments Tab */}
          {activeTab === "upcoming" && (
            <div className="grid gap-6 lg:grid-cols-3">
              <div className="lg:col-span-2">
                <Card className="border-3 border-foreground p-6 shadow-[4px_4px_0px_0px_rgba(26,26,26,1)]">
                  <h3 className="mb-6 text-lg font-bold">Payment Schedule</h3>
                  <div className="space-y-3">
                    {paymentSchedule.map((payment) => (
                      <div
                        key={`${payment.month}-${payment.dueDate}-${payment.amount}`}
                        className={`flex items-center justify-between border-3 border-foreground p-4 ${
                          payment.status === "upcoming" ? "bg-primary/10" : "bg-card"
                        }`}
                      >
                        <div className="flex items-center gap-4">
                          <div
                            className={`flex h-10 w-10 items-center justify-center border-2 border-foreground ${
                              payment.status === "upcoming" ? "bg-primary" : "bg-muted"
                            }`}
                          >
                            {payment.status === "upcoming" ? (
                              <AlertCircle className="h-5 w-5" />
                            ) : (
                              <Clock className="h-5 w-5" />
                            )}
                          </div>
                          <div>
                            <p className="font-bold">{payment.month}</p>
                            <p className="text-sm text-muted-foreground">Due {payment.dueDate}</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-4">
                          <span className="font-mono font-bold">{formatCurrency(payment.amount)}</span>
                          {payment.status === "upcoming" && (
                            <Button className="border-2 border-foreground bg-primary font-bold shadow-[2px_2px_0px_0px_rgba(26,26,26,1)]">
                              Pay Now
                            </Button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </Card>
              </div>

              {/* Quick Pay */}
              <Card className="border-3 border-foreground p-6 shadow-[4px_4px_0px_0px_rgba(26,26,26,1)]">
                <h3 className="mb-4 text-lg font-bold">Quick Pay</h3>
                <p className="mb-6 text-sm text-muted-foreground">
                  Make a manual payment towards your next installment
                </p>

                <div className="mb-4 border-3 border-foreground bg-muted/50 p-4">
                  <p className="text-sm text-muted-foreground">Wallet Balance</p>
                  <p className="text-2xl font-bold">{formatCurrency(walletBalance)}</p>
                  {walletBalance >= (nextPayment?.amount || 0) && (
                    <p className="mt-1 text-sm text-secondary">Sufficient for next payment</p>
                  )}
                </div>

                <Button className="mb-4 w-full border-3 border-foreground bg-primary font-bold shadow-[4px_4px_0px_0px_rgba(26,26,26,1)] transition-all hover:translate-x-0.5 hover:translate-y-0.5 hover:shadow-[2px_2px_0px_0px_rgba(26,26,26,1)]">
                  <Wallet className="mr-2 h-4 w-4" />
                  Pay from Wallet
                </Button>

                <Button
                  variant="outline"
                  className="w-full border-3 border-foreground bg-transparent font-bold shadow-[4px_4px_0px_0px_rgba(26,26,26,1)]"
                >
                  <CreditCard className="mr-2 h-4 w-4" />
                  Pay with Card
                </Button>

                <div className="mt-6 border-t-2 border-foreground pt-4">
                  <p className="text-xs text-muted-foreground">
                    Payments from your wallet are processed instantly. Card payments may take 1-2 business days.
                  </p>
                </div>
              </Card>
            </div>
          )}

          {/* Payment History Tab */}
          {activeTab === "history" && (
            <Card className="border-3 border-foreground p-6 shadow-[4px_4px_0px_0px_rgba(26,26,26,1)]">
              <h3 className="mb-6 text-lg font-bold">Payment History</h3>
              <div className="space-y-3">
                {pastPayments.length === 0 ? (
                  <div className="flex flex-col items-center py-12 text-center">
                    <div className="flex h-16 w-16 items-center justify-center border-3 border-foreground bg-muted">
                      <Receipt className="h-8 w-8 text-muted-foreground" />
                    </div>
                    <h3 className="mt-4 font-bold">No payment history</h3>
                    <p className="mt-2 text-sm text-muted-foreground">
                      Your completed payments will appear here.
                    </p>
                  </div>
                ) : pastPayments.map((payment) => (
                  <div
                    key={`${payment.month}-${payment.paidDate}-${payment.amount}`}
                    className="flex items-center justify-between border-b-2 border-foreground/10 pb-3 last:border-0"
                  >
                    <div className="flex items-center gap-4">
                      <div className="flex h-10 w-10 items-center justify-center border-2 border-foreground bg-secondary">
                        <CheckCircle className="h-5 w-5" />
                      </div>
                      <div>
                        <p className="font-bold">{payment.month}</p>
                        <p className="text-sm text-muted-foreground">
                          Paid on {payment.paidDate} via {payment.method}
                        </p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="font-mono font-bold">{formatCurrency(payment.amount)}</p>
                      <span className="border-2 border-foreground bg-secondary px-2 py-0.5 text-xs font-bold">Paid</span>
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          )}

          {/* Wallet Tab */}
          {activeTab === "wallet" && (
            <div className="grid gap-6 lg:grid-cols-2">
              <Card className="border-3 border-foreground p-6 shadow-[4px_4px_0px_0px_rgba(26,26,26,1)]">
                <h3 className="mb-4 text-lg font-bold">Your Wallet</h3>
                <div className="mb-6 border-3 border-foreground bg-primary/10 p-6">
                  <p className="text-sm text-muted-foreground">Wallet Balance</p>
                  <p className="text-4xl font-bold">{formatCurrency(walletBalance)}</p>
                  <p className="mt-2 text-sm text-muted-foreground">Last top-up: {walletData.lastTopUp}</p>
                </div>

                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="top-up-amount" className="font-bold">Top Up Amount</Label>
                    <Input
                      id="top-up-amount"
                      type="number"
                      value={topUpAmount}
                      onChange={(e) => setTopUpAmount(e.target.value)}
                      placeholder="Enter amount"
                      className="border-3 border-foreground bg-background py-5 shadow-[3px_3px_0px_0px_rgba(26,26,26,1)]"
                    />
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    {[50000, 100000, 200000].map((amount) => (
                      <button
                        key={amount}
                        onClick={() => setTopUpAmount(amount.toString())}
                        className="border-2 border-foreground bg-muted p-2 text-sm font-bold transition-all hover:bg-muted/80"
                      >
                        {formatCurrency(amount)}
                      </button>
                    ))}
                  </div>
                  <Button className="w-full border-3 border-foreground bg-primary font-bold shadow-[4px_4px_0px_0px_rgba(26,26,26,1)] transition-all hover:translate-x-0.5 hover:translate-y-0.5 hover:shadow-[2px_2px_0px_0px_rgba(26,26,26,1)]">
                    <Plus className="mr-2 h-4 w-4" />
                    Top Up Wallet
                  </Button>
                </div>
              </Card>

              <Card className="border-3 border-foreground p-6 shadow-[4px_4px_0px_0px_rgba(26,26,26,1)]">
                <h3 className="mb-4 text-lg font-bold">How Wallet Works</h3>
                <div className="space-y-4">
                  <div className="flex gap-4">
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center border-2 border-foreground bg-primary font-bold">
                      1
                    </div>
                    <div>
                      <p className="font-bold">Top up your wallet</p>
                      <p className="text-sm text-muted-foreground">
                        Add funds anytime between payments to build up your balance
                      </p>
                    </div>
                  </div>
                  <div className="flex gap-4">
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center border-2 border-foreground bg-secondary font-bold">
                      2
                    </div>
                    <div>
                      <p className="font-bold">Wallet is checked first</p>
                      <p className="text-sm text-muted-foreground">
                        When payment is due, we check your wallet balance first
                      </p>
                    </div>
                  </div>
                  <div className="flex gap-4">
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center border-2 border-foreground bg-accent font-bold">
                      3
                    </div>
                    <div>
                      <p className="font-bold">Auto-debit covers the rest</p>
                      <p className="text-sm text-muted-foreground">
                        If wallet is insufficient, the remainder is charged to your linked account
                      </p>
                    </div>
                  </div>
                  <div className="flex gap-4">
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center border-2 border-foreground bg-muted font-bold">
                      4
                    </div>
                    <div>
                      <p className="font-bold">Pay ahead anytime</p>
                      <p className="text-sm text-muted-foreground">
                        Make manual payments towards future installments whenever you want
                      </p>
                    </div>
                  </div>
                </div>

                <div className="mt-6 border-t-2 border-foreground pt-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-bold">Auto-pay Enabled</p>
                      <p className="text-sm text-muted-foreground">Payments are automatically deducted</p>
                    </div>
                    <div className="flex h-6 w-12 items-center rounded-none border-2 border-foreground bg-secondary p-0.5">
                      <div className="ml-auto h-4 w-4 border border-foreground bg-foreground" />
                    </div>
                  </div>
                </div>
              </Card>
            </div>
          )}
        </div>
      </main>
    </div>
  )
}
