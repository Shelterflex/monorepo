"use client"

import { FormEvent, useEffect, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { ArrowLeft, CheckCircle2, ShieldCheck, Sparkles } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { apiGet, apiPost } from "@/lib/apiClient"
import { LandlordVerificationBadge, type LandlordVerificationLevel } from "@/components/LandlordVerificationBadge"
import { formatDateTime } from "@/lib/date"

const verificationLevels: Array<{ value: LandlordVerificationLevel; label: string }> = [
  { value: "unverified", label: "Unverified" },
  { value: "id_verified", label: "ID Verified" },
  { value: "id_and_property_verified", label: "Landlord + Property Verified" },
  { value: "premium", label: "Premium Verified" },
]

interface VerificationStatusResponse {
  level: LandlordVerificationLevel
  verifiedAt: string | null
}

interface PageProps {
  params: {
    id: string
  }
}

export default function AdminLandlordVerificationPage({ params }: PageProps) {
  const router = useRouter()
  const [verificationLevel, setVerificationLevel] = useState<LandlordVerificationLevel>("unverified")
  const [currentStatus, setCurrentStatus] = useState<VerificationStatusResponse | null>(null)
  const [reason, setReason] = useState("")
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [showConfirm, setShowConfirm] = useState(false)
  const [pendingLevel, setPendingLevel] = useState<LandlordVerificationLevel | null>(null)

  useEffect(() => {
    void (async () => {
      setLoading(true)
      setError(null)
      try {
        const status = await apiGet<VerificationStatusResponse>(`/landlords/${encodeURIComponent(params.id)}/verification-status`)
        setCurrentStatus(status)
        setVerificationLevel(status.level)
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load landlord verification status")
      } finally {
        setLoading(false)
      }
    })()
  }, [params.id])

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError(null)
    setSuccess(null)
    setPendingLevel(verificationLevel)
    setShowConfirm(true)
  }

  const handleConfirm = async () => {
    if (!pendingLevel || !reason.trim()) return
    setSaving(true)

    try {
      await apiPost<{ success: boolean }>(`/admin/landlords/${encodeURIComponent(params.id)}/verify`, {
        verificationLevel: pendingLevel,
        note: reason,
      })
      setSuccess("Verification status updated successfully.")
      setCurrentStatus({ level: pendingLevel, verifiedAt: new Date().toISOString() })
      setVerificationLevel(pendingLevel)
      setShowConfirm(false)
      setPendingLevel(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update verification status")
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="min-h-screen bg-background p-6">
      <div className="mx-auto max-w-5xl space-y-6">
        <div className="flex items-center justify-between gap-4">
          <div>
            <Link href="/admin" className="inline-flex items-center gap-2 text-sm font-bold text-muted-foreground hover:text-foreground">
              <ArrowLeft className="h-4 w-4" /> Back to admin
            </Link>
            <h1 className="mt-4 text-3xl font-black">Landlord Verification</h1>
            <p className="text-muted-foreground mt-2">
              Set the public landlord verification level and record an audit reason for this update.
            </p>
          </div>
          <div>
            <span className="text-sm text-muted-foreground">Landlord ID</span>
            <p className="font-mono font-bold">{params.id}</p>
          </div>
        </div>

        <div className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
          <Card className="border-2 border-foreground bg-card p-6">
            <form onSubmit={handleSubmit} className="space-y-6">
              <div className="space-y-3">
                <Label htmlFor="verificationLevel">Verification Level</Label>
                <div className="grid gap-2 sm:grid-cols-2">
                  {verificationLevels.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => setVerificationLevel(option.value)}
                      className={`rounded-lg border-2 px-4 py-3 text-left transition-all ${
                        verificationLevel === option.value
                          ? 'border-primary bg-primary/10 text-foreground'
                          : 'border-muted-foreground bg-background text-muted-foreground'
                      }`}
                    >
                      <div className="font-bold">{option.label}</div>
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="reason">Reason for Change</Label>
                <Textarea
                  id="reason"
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  placeholder="Enter a short reason for the audit log"
                  className="min-h-[120px] border-2 border-foreground bg-background"
                />
              </div>

              {error ? (
                <p className="text-sm text-destructive">{error}</p>
              ) : null}
              {success ? (
                <p className="text-sm text-green-700">{success}</p>
              ) : null}

              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex flex-wrap gap-2">
                  <LandlordVerificationBadge level={verificationLevel} />
                </div>
                <Button type="submit" disabled={saving || reason.length === 0} className="border-2 border-foreground font-bold">
                  {saving ? 'Updating…' : 'Update Verification'}
                </Button>
              </div>

              {showConfirm && (
                <div className="mt-6 border-3 border-destructive bg-destructive/10 p-6">
                  <h3 className="font-bold text-lg mb-3">Confirm verification level change</h3>
                  <p className="text-sm mb-4">
                    You are about to change the verification level to <strong>{pendingLevel}</strong>.
                  </p>
                  <p className="text-sm text-muted-foreground mb-4">
                    Reason: {reason}
                  </p>
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => {
                        setShowConfirm(false)
                        setPendingLevel(null)
                      }}
                      disabled={saving}
                    >
                      Cancel
                    </Button>
                    <Button
                      type="button"
                      variant="destructive"
                      onClick={() => void handleConfirm()}
                      disabled={saving}
                      className="border-2 border-destructive font-bold"
                    >
                      {saving ? 'Confirming…' : 'Confirm Change'}
                    </Button>
                  </div>
                </div>
              )}
            </form>
          </Card>

          <Card className="border-2 border-foreground bg-card p-6">
            <div className="space-y-4">
              <div className="flex items-center gap-2 text-muted-foreground">
                <ShieldCheck className="h-4 w-4" />
                <span className="font-bold">Current Status</span>
              </div>

              {loading ? (
                <p className="text-sm text-muted-foreground">Loading verification status…</p>
              ) : currentStatus ? (
                <div className="space-y-4">
                  <div className="flex items-center gap-3">
                    <LandlordVerificationBadge level={currentStatus.level} />
                    <span className="text-sm text-muted-foreground">
                      Last verified: {currentStatus.verifiedAt ? formatDateTime(currentStatus.verifiedAt) : 'Never'}
                    </span>
                  </div>
                  <div className="rounded-xl border border-foreground/20 bg-muted p-4">
                    <p className="text-sm text-muted-foreground">This page uses the public landlord verification status endpoint.</p>
                  </div>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">Unable to load landlord verification status.</p>
              )}
            </div>
          </Card>
        </div>
      </div>
    </div>
  )
}
