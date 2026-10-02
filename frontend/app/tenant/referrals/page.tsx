'use client'

import { useState, useEffect } from 'react'
import { Users, Clock, TrendingUp } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { DashboardHeader } from '@/components/dashboard-header'
import { ReferralShareCard } from '@/components/ReferralShareCard'
import { apiGet } from '@/lib/apiClient'
import { toast } from 'sonner'

interface ReferralStats {
  code: string
  referralLink: string
  totalReferred: number
  pendingRewards: number
  appliedRewards: number
  totalRewardAmountNgn: number
  isEligible?: boolean
  eligibilityMessage?: string
}

export default function ReferralsPage() {
  const [stats, setStats] = useState<ReferralStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [isEligible, setIsEligible] = useState(true)

  useEffect(() => {
    const fetchStats = async () => {
      try {
        const response = await apiGet<{
          success: boolean
          data: ReferralStats
        }>('/api/v1/tenant/referral')
        setStats(response.data)
        setIsEligible(response.data.isEligible ?? true)
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : 'Failed to load referral stats'
        setError(errorMessage)
        toast.error(errorMessage)
        console.error(err)
      } finally {
        setLoading(false)
      }
    }

    fetchStats()
  }, [])


  if (loading) {
    return (
      <div className="min-h-screen bg-background">
        <DashboardHeader />
        <main id="main-content" className="container max-w-4xl mx-auto px-4 py-8">
          <ReferralShareCard loading={true} />
        </main>
      </div>
    )
  }

  if (error || !stats) {
    return (
      <div className="min-h-screen bg-background">
        <DashboardHeader />
        <main id="main-content" className="container max-w-4xl mx-auto px-4 py-8">
          <ReferralShareCard error={error || 'Failed to load referral program'} />
        </main>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-background">
      <DashboardHeader />

      <main id="main-content" className="container max-w-4xl mx-auto px-4 py-8 space-y-8">
        {/* Header */}
        <div>
          <h1 className="text-3xl font-bold text-foreground">Referral Programme</h1>
          <p className="text-muted-foreground mt-2">
            Invite friends and earn ₦5,000 per successful referral
          </p>
        </div>

        {/* Share Card */}
        <ReferralShareCard
          referralCode={stats.code}
          referralLink={stats.referralLink}
          stats={stats}
          isEligible={isEligible}
        />

        {/* Detailed Stats */}
        {isEligible && (
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <Card className="border-2 border-border p-4">
              <div className="flex items-center gap-2 mb-2">
                <Users className="h-5 w-5 text-foreground" />
                <span className="text-xs font-bold text-muted-foreground">Total Referred</span>
              </div>
              <p className="text-2xl font-bold text-foreground">{stats.totalReferred}</p>
            </Card>

            <Card className="border-2 border-border p-4">
              <div className="flex items-center gap-2 mb-2">
                <Clock className="h-5 w-5 text-amber-600" />
                <span className="text-xs font-bold text-muted-foreground">Pending</span>
              </div>
              <p className="text-2xl font-bold text-foreground">{stats.pendingRewards}</p>
            </Card>

            <Card className="border-2 border-border p-4">
              <div className="flex items-center gap-2 mb-2">
                <TrendingUp className="h-5 w-5 text-green-600" />
                <span className="text-xs font-bold text-muted-foreground">Applied</span>
              </div>
              <p className="text-2xl font-bold text-foreground">{stats.appliedRewards}</p>
            </Card>

            <Card className="border-2 border-border p-4">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-xs font-bold text-muted-foreground">Total Earned</span>
              </div>
              <p className="text-2xl font-bold text-foreground">
                ₦{(stats.totalRewardAmountNgn / 1000).toFixed(0)}k
              </p>
            </Card>
          </div>
        )}

        {/* How It Works */}
        <Card className="border-2 border-border p-6">
          <h2 className="text-xl font-bold text-foreground mb-4">How It Works</h2>

          <div className="space-y-4">
            <div className="flex gap-4">
              <div className="flex-shrink-0">
                <div className="flex h-8 w-8 items-center justify-center rounded-full border-2 border-foreground font-bold text-foreground">
                  1
                </div>
              </div>
              <div>
                <p className="font-bold text-foreground">Share your code or link</p>
                <p className="text-sm text-muted-foreground">
                  Send your referral code or link to friends via WhatsApp, email, or any channel
                </p>
              </div>
            </div>

            <div className="flex gap-4">
              <div className="flex-shrink-0">
                <div className="flex h-8 w-8 items-center justify-center rounded-full border-2 border-foreground font-bold text-foreground">
                  2
                </div>
              </div>
              <div>
                <p className="font-bold text-foreground">Friend registers with your code</p>
                <p className="text-sm text-muted-foreground">
                  They complete registration on Shelterflex using your referral code
                </p>
              </div>
            </div>

            <div className="flex gap-4">
              <div className="flex-shrink-0">
                <div className="flex h-8 w-8 items-center justify-center rounded-full border-2 border-foreground font-bold text-foreground">
                  3
                </div>
              </div>
              <div>
                <p className="font-bold text-foreground">Their first deal activates</p>
                <p className="text-sm text-muted-foreground">
                  When they activate their first rental deal, you get ₦5,000 credit
                </p>
              </div>
            </div>

            <div className="flex gap-4">
              <div className="flex-shrink-0">
                <div className="flex h-8 w-8 items-center justify-center rounded-full border-2 border-foreground font-bold text-foreground">
                  4
                </div>
              </div>
              <div>
                <p className="font-bold text-foreground">Credit applied automatically</p>
                <p className="text-sm text-muted-foreground">
                  The reward is automatically applied as a credit to your next payment
                </p>
              </div>
            </div>
          </div>
        </Card>
      </main>
    </div>
  )
}
