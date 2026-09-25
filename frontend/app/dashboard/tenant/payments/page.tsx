"use client"

import { useEffect, useState } from "react"
import {
  Calendar,
  AlertCircle,
  Wallet,
  Loader2,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { DashboardHeader } from "@/components/dashboard-header"
import { DashboardSidebar } from "@/components/dashboard/DashboardSidebar"
import {
  getPaymentSchedule,
  getWalletBalance,
  getMyDisputes,
  initiateQuickPay,
  type PaymentScheduleItem,
  type TenantDeal,
  type PaymentDispute,
} from "@/lib/tenantApi"
import { showErrorToast, showSuccessToast } from "@/lib/toast"
import { usePaymentHistory } from "@/hooks/usePaymentHistory"
import { PaymentTimeline } from "@/components/payment/PaymentTimeline"
import { UpcomingScheduleTable } from "@/components/payment/UpcomingScheduleTable"
import { DisputeDialog } from "@/components/payment/DisputeDialog"
import { DisputeStatusTimeline } from "@/components/payment/DisputeStatusTimeline"
import { FullPaymentModal } from "@/components/payment/FullPaymentModal"
import type { FullPaymentReceipt } from "@/lib/paymentApi"
import { canFileDispute } from "@/lib/disputeTimeline"
import { formatNgn } from "@/lib/currency"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import type { PaymentHistoryItem } from "@/lib/tenantApi"

type ActiveTab = "schedule" | "history"

export default function TenantPaymentsPage() {
  const [activeTab, setActiveTab] = useState<ActiveTab>("schedule")
  const [walletBalance, setWalletBalance] = useState(0)
  const [paymentSchedule, setPaymentSchedule] = useState<PaymentScheduleItem[]>([])
  const [nextPayment, setNextPayment] = useState<PaymentScheduleItem | null>(null)
  const [deals, setDeals] = useState<TenantDeal[]>([])
  const [selectedDeal, setSelectedDeal] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isProcessing, setIsProcessing] = useState(false)
  const [submittingPeriod, setSubmittingPeriod] = useState<number | null>(null)
  const [optimisticStatuses, setOptimisticStatuses] = useState<Record<number, "pending" | "failed">>({})
  const [disputes, setDisputes] = useState<PaymentDispute[]>([])
  const [disputeDialogPayment, setDisputeDialogPayment] = useState<PaymentHistoryItem | null>(null)
  const [viewDispute, setViewDispute] = useState<PaymentDispute | null>(null)
  const [fullPaymentModalOpen, setFullPaymentModalOpen] = useState(false)

  const {
    payments,
    loadMore,
    hasMore,
    isLoading: isHistoryLoading,
  } = usePaymentHistory({
    dealId: selectedDeal,
    limit: 10,
  })

  const loadData = async () => {
    setIsLoading(true)
    try {
      const [scheduleRes, walletRes, disputesRes] = await Promise.all([
        getPaymentSchedule(),
        getWalletBalance(),
        getMyDisputes(),
      ])

      if (scheduleRes.success) {
        setPaymentSchedule(scheduleRes.data.schedule)
        setNextPayment(scheduleRes.data.nextPayment)
        setDeals(scheduleRes.data.deals ?? [])
        setSelectedDeal(
          scheduleRes.data.dealId || scheduleRes.data.deals?.[0]?.dealId || null,
        )
      }

      if (walletRes.success) {
        setWalletBalance(walletRes.data.balance)
      }

      if (disputesRes.success) {
        setDisputes(disputesRes.data.disputes)
      }
    } catch (error: any) {
      showErrorToast(error?.message || "Failed to load payment data")
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    void loadData()
  }, [])

  const handleQuickPay = async (method: "wallet" | "card") => {
    if (!selectedDeal || !nextPayment) {
      showErrorToast("No active payment found")
      return
    }
    if (submittingPeriod !== null) return

    const period = nextPayment.period
    const idempotencyKey = typeof crypto !== "undefined" && crypto.randomUUID
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random()}`

    setSubmittingPeriod(period)
    setIsProcessing(true)
    setOptimisticStatuses((prev) => ({ ...prev, [period]: "pending" }))

    try {
      const response = await initiateQuickPay({
        dealId: selectedDeal,
        amount: nextPayment.amount,
        paymentMethod: method,
        idempotencyKey,
      })

      if (response.success) {
        if (response.data.redirectUrl) {
          window.location.href = response.data.redirectUrl
        } else {
          showSuccessToast(response.data.message)
          setOptimisticStatuses((prev) => {
            const next = { ...prev }
            delete next[period]
            return next
          })
          await loadData()
        }
      }
    } catch (error: any) {
      setOptimisticStatuses((prev) => ({ ...prev, [period]: "failed" }))
      showErrorToast(error?.message || "Payment failed")
      setTimeout(() => {
        setOptimisticStatuses((prev) => {
          const next = { ...prev }
          delete next[period]
          return next
        })
      }, 5000)
    } finally {
      setIsProcessing(false)
      setSubmittingPeriod(null)
    }
  }

  const handleReceiptDownload = (reference: string) => {
    window.open(`/api/v1/tenant/payments/receipt/${reference}`, "_blank")
  }

  const disputeStatusByPayment: Record<string, PaymentDispute["status"] | null> = {}
  for (const dispute of disputes) {
    disputeStatusByPayment[dispute.paymentId] = dispute.status
  }

  const handleReportProblem = (paymentId: string) => {
    const payment = payments.find((p) => p.id === paymentId)
    if (!payment) return
    if (!canFileDispute(disputes, paymentId)) {
      showErrorToast("You already have an open dispute for this payment.")
      return
    }
    setDisputeDialogPayment(payment)
  }

  const handleViewDispute = (paymentId: string) => {
    const dispute = disputes.find((d) => d.paymentId === paymentId)
    if (dispute) setViewDispute(dispute)
  }

  const handleDisputeFiled = () => {
    void loadData()
  }

  const handleFullPaymentSuccess = (receipt: FullPaymentReceipt) => {
    showSuccessToast(`Full payment confirmed (ref ${receipt.reference})`)
    void loadData()
  }

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background">
        <DashboardHeader />
        <main className="ml-64 min-h-screen pt-20 flex items-center justify-center">
          <div
            aria-live="polite"
            aria-busy="true"
            className="flex flex-col items-center gap-4 rounded-3xl border-3 border-foreground bg-card p-10 shadow-[4px_4px_0px_0px_rgba(26,26,26,1)]"
          >
            <Loader2 className="h-10 w-10 animate-spin text-foreground" aria-hidden="true" />
            <p className="text-sm font-bold text-foreground">Loading payment details...</p>
          </div>
        </main>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-background">
      <DashboardHeader />

      <DashboardSidebar
        role="tenant"
        userInfo={{ name: "Ngozi Adekunle", roleLabel: "Tenant" }}
      />

      <main className="lg:ml-64 min-h-screen pt-20">
        <div className="p-8">
          <div className="mb-8">
            <h1 className="text-3xl font-bold text-foreground">Payments</h1>
            <p className="mt-1 text-muted-foreground">Manage your rent payments and wallet</p>
          </div>

          {/* Quick Stats */}
          <div className="mb-8 grid grid-cols-3 gap-4">
            <Card className="border-3 border-foreground p-4 shadow-[4px_4px_0px_0px_rgba(26,26,26,1)]">
              <div className="flex items-center gap-3">
                <div
                  className="flex h-12 w-12 items-center justify-center border-3 border-foreground bg-primary"
                  aria-hidden="true"
                >
                  <Wallet className="h-6 w-6" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Wallet Balance</p>
                  <p className="text-xl font-bold">{formatNgn(walletBalance)}</p>
                </div>
              </div>
            </Card>
            <Card className="border-3 border-foreground p-4 shadow-[4px_4px_0px_0px_rgba(26,26,26,1)]">
              <div className="flex items-center gap-3">
                <div
                  className="flex h-12 w-12 items-center justify-center border-3 border-foreground bg-secondary"
                  aria-hidden="true"
                >
                  <AlertCircle className="h-6 w-6" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Next Payment</p>
                  <p className="text-xl font-bold">
                    {nextPayment ? formatNgn(nextPayment.amount) : "N/A"}
                  </p>
                </div>
              </div>
            </Card>
            <Card className="border-3 border-foreground p-4 shadow-[4px_4px_0px_0px_rgba(26,26,26,1)]">
              <div className="flex items-center gap-3">
                <div
                  className="flex h-12 w-12 items-center justify-center border-3 border-foreground bg-accent"
                  aria-hidden="true"
                >
                  <Calendar className="h-6 w-6" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Due Date</p>
                  <p className="text-xl font-bold">
                    {nextPayment ? nextPayment.dueDate : "N/A"}
                  </p>
                </div>
              </div>
            </Card>
          </div>

          {/* Tabs */}
          <div className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div
              role="tablist"
              aria-label="Payment sections"
              className="flex flex-wrap gap-4"
            >
              {(
                [
                  { id: "schedule", label: "Schedule" },
                  { id: "history", label: "History" },
                ] as { id: ActiveTab; label: string }[]
              ).map((tab) => (
                <button
                  key={tab.id}
                  role="tab"
                  id={`tab-${tab.id}`}
                  aria-selected={activeTab === tab.id}
                  aria-controls={`panel-${tab.id}`}
                  onClick={() => setActiveTab(tab.id)}
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

            {deals.length > 1 ? (
              <div className="flex flex-col gap-2 rounded-3xl border-2 border-foreground/10 bg-muted p-4">
                <Label htmlFor="deal-select" className="text-sm font-bold">
                  Select deal
                </Label>
                <select
                  id="deal-select"
                  value={selectedDeal ?? ""}
                  onChange={(event) => setSelectedDeal(event.target.value)}
                  className="rounded-2xl border-2 border-foreground/20 bg-background px-4 py-3 text-foreground"
                >
                  {deals.map((deal) => (
                    <option key={deal.dealId} value={deal.dealId}>
                      {deal.leaseName}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}
          </div>

          {/* Schedule Tab Panel */}
          <div
            role="tabpanel"
            id="panel-schedule"
            aria-labelledby="tab-schedule"
            tabIndex={0}
            hidden={activeTab !== "schedule"}
            className="space-y-6"
          >
            <Card className="border-3 border-foreground p-6 shadow-[4px_4px_0px_0px_rgba(26,26,26,1)]">
              <div className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <h3 className="text-lg font-bold">Payment Schedule</h3>
                  <p className="mt-2 text-sm text-muted-foreground">
                    Track upcoming installments and pay the next due item from one place.
                  </p>
                </div>
                {nextPayment ? (
                  <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center">
                    <div className="rounded-3xl border-2 border-foreground/20 bg-muted p-4">
                      <p className="text-sm text-muted-foreground">Next due installment</p>
                      <p className="text-2xl font-bold">{formatNgn(nextPayment.amount)}</p>
                      <p className="text-sm text-muted-foreground">Due {nextPayment.dueDate}</p>
                    </div>
                    {selectedDeal ? (
                      <Button
                        variant="outline"
                        onClick={() => setFullPaymentModalOpen(true)}
                      >
                        Pay in Full
                      </Button>
                    ) : null}
                  </div>
                ) : null}
              </div>

              {paymentSchedule.length === 0 ? (
                <div className="flex flex-col items-center py-12 text-center">
                  <Calendar className="h-16 w-16 text-muted-foreground" aria-hidden="true" />
                  <h3 className="mt-4 font-bold">No upcoming installments</h3>
                  <p className="mt-2 text-sm text-muted-foreground">
                    Your future repayment schedule will appear here when available.
                  </p>
                </div>
              ) : (
                <UpcomingScheduleTable
                  schedule={paymentSchedule.map((payment) => ({
                    period: payment.period,
                    month: payment.month,
                    amount: payment.amount,
                    dueDate: payment.dueDate,
                    status: payment.status,
                    isNextDue: payment.isNextDue,
                  }))}
                  onPayNow={() => handleQuickPay("card")}
                  optimisticStatuses={optimisticStatuses}
                />
              )}

              {isProcessing && (
                <div aria-live="polite" className="mt-4 flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  Processing payment…
                </div>
              )}
            </Card>
          </div>

          {/* History Tab Panel */}
          <div
            role="tabpanel"
            id="panel-history"
            aria-labelledby="tab-history"
            tabIndex={0}
            hidden={activeTab !== "history"}
          >
            <Card className="border-3 border-foreground p-6 shadow-[4px_4px_0px_0px_rgba(26,26,26,1)]">
              <div className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <h3 className="text-lg font-bold">Payment History</h3>
                  <p className="mt-2 text-sm text-muted-foreground">
                    Review completed installments, download receipts, and confirm payment status.
                  </p>
                </div>
                <div className="rounded-3xl border-2 border-foreground/20 bg-muted p-4 text-sm">
                  {payments.length} payment{payments.length === 1 ? "" : "s"} recorded
                </div>
              </div>

              <PaymentTimeline
                payments={payments}
                onDownloadReceipt={handleReceiptDownload}
                onLoadMore={loadMore}
                hasMore={hasMore}
                isLoading={isHistoryLoading}
                disputeStatusByPayment={disputeStatusByPayment}
                onReportProblem={handleReportProblem}
                onViewDispute={handleViewDispute}
              />
            </Card>
          </div>
        </div>
      </main>

      {disputeDialogPayment ? (
        <DisputeDialog
          payment={disputeDialogPayment}
          open={true}
          onOpenChange={(open) => {
            if (!open) setDisputeDialogPayment(null)
          }}
          onFiled={handleDisputeFiled}
        />
      ) : null}

      <Dialog open={viewDispute !== null} onOpenChange={(open) => { if (!open) setViewDispute(null) }}>
        <DialogContent className="border-3 border-foreground shadow-[4px_4px_0px_0px_rgba(26,26,26,1)]">
          <DialogHeader>
            <DialogTitle>Dispute Status</DialogTitle>
            <DialogDescription>
              Track your dispute through review and resolution.
            </DialogDescription>
          </DialogHeader>
          {viewDispute ? <DisputeStatusTimeline dispute={viewDispute} /> : null}
        </DialogContent>
      </Dialog>

      {selectedDeal ? (
        <FullPaymentModal
          paymentId={selectedDeal}
          open={fullPaymentModalOpen}
          onOpenChange={setFullPaymentModalOpen}
          onSuccess={handleFullPaymentSuccess}
        />
      ) : null}
    </div>
  )
}
