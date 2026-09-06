"use client"

import { useState, useEffect } from "react"
import Link from "next/link"
import { useParams } from "next/navigation"
import { ArrowLeft, AlertCircle, CheckCircle2, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Card } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { apiGet, apiPost } from "@/lib/apiClient"
import { formatDateTime } from "@/lib/date"

interface KycRecord {
  id: string
  userId: string
  documentType: string
  frontImageKey: string
  backImageKey?: string | null
  status: "pending" | "in_review" | "approved" | "rejected" | "expired"
  createdAt: string
  updatedAt: string
  rejectionReason?: string | null
  reviewedBy?: string | null
  livenessSignal?: string | null
}

interface AllowlistStatus {
  isAllowlisted: boolean
  hasWalletAddress: boolean
  walletAddress: string | null
  entry: {
    label: string
    expires_at: number
    added_at: number
  } | null
}

const statusConfig: Record<KycRecord["status"], { color: string; label: string }> = {
  pending: { color: "bg-yellow-100 text-yellow-800", label: "Pending" },
  in_review: { color: "bg-blue-100 text-blue-800", label: "In Review" },
  approved: { color: "bg-green-100 text-green-800", label: "Approved" },
  rejected: { color: "bg-red-100 text-red-800", label: "Rejected" },
  expired: { color: "bg-gray-100 text-gray-800", label: "Expired" },
}

export default function KycSubmissionDetailPage() {
  const params = useParams()
  const submissionId = params.submissionId as string

  const [record, setRecord] = useState<KycRecord | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [actionLoading, setActionLoading] = useState(false)
  const [dialogType, setDialogType] = useState<"approve" | "reject" | null>(null)
  const [reason, setReason] = useState("")
  const [allowlistStatus, setAllowlistStatus] = useState<AllowlistStatus | null>(null)
  const [allowlistLoading, setAllowlistLoading] = useState(false)

  useEffect(() => {
    const fetchData = async () => {
      try {
        const result = await apiGet<{ success: boolean; data: KycRecord }>(
          `/api/kyc/admin/${submissionId}`
        )
        setRecord(result.data)
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load submission")
      } finally {
        setLoading(false)
      }
    }
    void fetchData()
  }, [submissionId])

  useEffect(() => {
    if (!record) return

    const fetchAllowlistStatus = async () => {
      setAllowlistLoading(true)
      try {
        const result = await apiGet<{ success: boolean; data: AllowlistStatus }>(
          `/api/kyc/admin/${submissionId}/allowlist-status`
        )
        setAllowlistStatus(result.data)
      } catch (err) {
        console.error("Failed to load allowlist status:", err)
      } finally {
        setAllowlistLoading(false)
      }
    }
    void fetchAllowlistStatus()
  }, [record, submissionId])

  const handleApprove = async () => {
    if (!record) return
    setActionLoading(true)
    try {
      await apiPost(`/api/kyc/admin/${submissionId}/approve`, {
        reason: reason || undefined,
      })
      setRecord({ ...record, status: "approved" })
      setDialogType(null)
      setReason("")
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to approve")
    } finally {
      setActionLoading(false)
    }
  }

  const handleReject = async () => {
    if (!record) return
    setActionLoading(true)
    try {
      await apiPost(`/api/kyc/admin/${submissionId}/reject`, {
        reason: reason || "Rejected by admin",
      })
      setRecord({ ...record, status: "rejected", rejectionReason: reason })
      setDialogType(null)
      setReason("")
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to reject")
    } finally {
      setActionLoading(false)
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-background p-6">
        <div className="mx-auto max-w-4xl">
          <Card className="border-2 border-foreground p-8 text-center">
            <p className="font-bold">Loading submission...</p>
          </Card>
        </div>
      </div>
    )
  }

  if (error || !record) {
    return (
      <div className="min-h-screen bg-background p-6">
        <div className="mx-auto max-w-4xl">
          <Link href="/admin/kyc" className="mb-6 inline-flex items-center gap-2 text-sm font-bold">
            <ArrowLeft className="h-4 w-4" />
            Back to Queue
          </Link>
          <Card className="border-2 border-destructive bg-destructive/10 p-6">
            <div className="flex gap-3">
              <AlertCircle className="h-6 w-6 text-destructive shrink-0" />
              <div>
                <p className="font-bold text-destructive">{error || "Submission not found"}</p>
              </div>
            </div>
          </Card>
        </div>
      </div>
    )
  }

  const cfg = statusConfig[record.status]
  const canApprove = record.status === "pending" || record.status === "in_review"
  const canReject = record.status === "pending" || record.status === "in_review"

  return (
    <div className="min-h-screen bg-background p-6">
      <div className="mx-auto max-w-4xl">
        <Link href="/admin/kyc" className="mb-6 inline-flex items-center gap-2 text-sm font-bold">
          <ArrowLeft className="h-4 w-4" />
          Back to Queue
        </Link>

        {/* Header */}
        <div className="mb-8">
          <div className="mb-4 flex items-start justify-between">
            <div>
              <h1 className="text-3xl font-black">Submission Review</h1>
              <p className="mt-2 text-muted-foreground font-mono text-sm">ID: {record.id}</p>
            </div>
            <Badge className={`border-2 border-foreground ${cfg.color}`}>{cfg.label}</Badge>
          </div>
        </div>

        {/* User Info */}
        <Card className="mb-6 border-2 border-foreground p-6 shadow-[2px_2px_0px_rgba(26,26,26,1)]">
          <h2 className="mb-4 font-bold">User Information</h2>
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <p className="text-xs text-muted-foreground uppercase">User ID</p>
              <p className="font-mono font-bold">{record.userId}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground uppercase">Document Type</p>
              <p className="font-bold capitalize">{record.documentType.replace(/_/g, " ")}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground uppercase">Submission Date</p>
              <p className="font-bold">{formatDateTime(record.createdAt)}</p>
            </div>
            {record.rejectionReason && (
              <div>
                <p className="text-xs text-muted-foreground uppercase">Rejection Reason</p>
                <p className="font-bold text-red-600">{record.rejectionReason}</p>
              </div>
            )}
          </div>
        </Card>

        {/* On-Chain Allowlist Status */}
        <Card className="mb-6 border-2 border-foreground p-6 shadow-[2px_2px_0px_rgba(26,26,26,1)]">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="font-bold">On-Chain Allowlist Status</h2>
            {allowlistLoading && <Loader2 className="h-4 w-4 animate-spin" />}
          </div>
          {allowlistStatus ? (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <p className="text-xs text-muted-foreground uppercase w-32">Wallet Address</p>
                <p className="font-mono text-sm">
                  {allowlistStatus.walletAddress || "No wallet address"}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <p className="text-xs text-muted-foreground uppercase w-32">Allowlisted</p>
                <Badge className={allowlistStatus.isAllowlisted ? "bg-green-100 text-green-800" : "bg-gray-100 text-gray-800"}>
                  {allowlistStatus.isAllowlisted ? "Yes" : "No"}
                </Badge>
              </div>
              {allowlistStatus.entry && (
                <>
                  <div className="flex items-center gap-2">
                    <p className="text-xs text-muted-foreground uppercase w-32">Label</p>
                    <p className="font-bold">{allowlistStatus.entry.label}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <p className="text-xs text-muted-foreground uppercase w-32">Added At</p>
                    <p className="font-mono text-sm">{formatDateTime(allowlistStatus.entry.added_at * 1000)}</p>
                  </div>
                  {allowlistStatus.entry.expires_at > 0 && (
                    <div className="flex items-center gap-2">
                      <p className="text-xs text-muted-foreground uppercase w-32">Expires At</p>
                      <p className="font-mono text-sm">{formatDateTime(allowlistStatus.entry.expires_at * 1000)}</p>
                    </div>
                  )}
                </>
              )}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              {allowlistLoading ? "Loading allowlist status..." : "Unable to load allowlist status"}
            </p>
          )}
        </Card>

        {/* Documents */}
        <Card className="mb-6 border-2 border-foreground p-6 shadow-[2px_2px_0px_rgba(26,26,26,1)]">
          <h2 className="mb-4 font-bold">Documents</h2>
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <p className="mb-2 text-xs text-muted-foreground uppercase font-bold">Front Document</p>
              <div className="flex h-48 items-center justify-center border-2 border-dashed border-foreground bg-muted">
                <p className="text-center text-sm text-muted-foreground">
                  {record.frontImageKey ? (
                    <span className="break-all">{record.frontImageKey}</span>
                  ) : (
                    "No document"
                  )}
                </p>
              </div>
            </div>
            {record.backImageKey && (
              <div>
                <p className="mb-2 text-xs text-muted-foreground uppercase font-bold">Back Document</p>
                <div className="flex h-48 items-center justify-center border-2 border-dashed border-foreground bg-muted">
                  <p className="text-center text-sm text-muted-foreground break-all">
                    {record.backImageKey}
                  </p>
                </div>
              </div>
            )}
          </div>
        </Card>

        {/* Decision */}
        {(canApprove || canReject) && (
          <Card className="border-2 border-primary p-6 shadow-[2px_2px_0px_rgba(26,26,26,1)]">
            <h2 className="mb-4 font-bold">Make a Decision</h2>
            <div className="flex gap-3">
              <Button
                onClick={() => setDialogType("approve")}
                className="border-2 border-foreground bg-green-500 font-bold hover:bg-green-600"
                disabled={!canApprove}
              >
                <CheckCircle2 className="mr-2 h-4 w-4" />
                Approve
              </Button>
              <Button
                onClick={() => setDialogType("reject")}
                variant="destructive"
                className="border-2 border-foreground font-bold"
                disabled={!canReject}
              >
                <AlertCircle className="mr-2 h-4 w-4" />
                Reject
              </Button>
            </div>
          </Card>
        )}

        {/* Dialogs */}
        <Dialog open={dialogType === "approve"} onOpenChange={(open) => !open && setDialogType(null)}>
          <DialogContent className="border-2 border-foreground">
            <DialogHeader>
              <DialogTitle>Approve Submission</DialogTitle>
              <DialogDescription>
                Are you sure you want to approve this KYC submission?
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <label className="text-sm font-bold">Notes (optional)</label>
                <Textarea
                  placeholder="Add any notes about this approval..."
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  className="mt-2 border-2 border-foreground"
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setDialogType(null)}>
                Cancel
              </Button>
              <Button
                onClick={() => void handleApprove()}
                disabled={actionLoading}
                className="border-2 border-foreground bg-green-500 font-bold"
              >
                {actionLoading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Approving...
                  </>
                ) : (
                  "Confirm Approval"
                )}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog open={dialogType === "reject"} onOpenChange={(open) => !open && setDialogType(null)}>
          <DialogContent className="border-2 border-foreground">
            <DialogHeader>
              <DialogTitle>Reject Submission</DialogTitle>
              <DialogDescription>
                Please provide a reason for rejecting this submission.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <label className="text-sm font-bold">Rejection Reason *</label>
                <Textarea
                  placeholder="Explain why this submission is being rejected..."
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  className="mt-2 border-2 border-foreground"
                  required
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setDialogType(null)}>
                Cancel
              </Button>
              <Button
                onClick={() => void handleReject()}
                disabled={actionLoading || !reason}
                variant="destructive"
                className="border-2 border-foreground font-bold"
              >
                {actionLoading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Rejecting...
                  </>
                ) : (
                  "Confirm Rejection"
                )}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  )
}
