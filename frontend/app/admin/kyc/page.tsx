"use client"

import { useState, useEffect, useCallback } from "react"
import Link from "next/link"
import {
  Search,
  ChevronLeft,
  ChevronRight,
  AlertCircle,
  CheckCircle2,
  Clock,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Card } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { apiGet } from "@/lib/apiClient"
import { formatDate } from "@/lib/date"

interface KycRecord {
  id: string
  userId: string
  documentType: string
  status: "pending" | "in_review" | "approved" | "rejected" | "expired"
  createdAt: Date
  updatedAt: Date
  reviewedBy?: string
}

interface ListResponse {
  records: KycRecord[]
  total: number
  page: number
  pageSize: number
  totalPages: number
}

const statusConfig: Record<KycRecord["status"], { color: string; icon: React.ReactNode; label: string }> = {
  pending: {
    color: "bg-yellow-100 text-yellow-800 border-yellow-300",
    icon: <Clock className="h-4 w-4" />,
    label: "Pending",
  },
  in_review: {
    color: "bg-blue-100 text-blue-800 border-blue-300",
    icon: <AlertCircle className="h-4 w-4" />,
    label: "In Review",
  },
  approved: {
    color: "bg-green-100 text-green-800 border-green-300",
    icon: <CheckCircle2 className="h-4 w-4" />,
    label: "Approved",
  },
  rejected: {
    color: "bg-red-100 text-red-800 border-red-300",
    icon: <AlertCircle className="h-4 w-4" />,
    label: "Rejected",
  },
  expired: {
    color: "bg-gray-100 text-gray-800 border-gray-300",
    icon: <AlertCircle className="h-4 w-4" />,
    label: "Expired",
  },
}

export default function KycReviewQueuePage() {
  const [records, setRecords] = useState<KycRecord[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const [status, setStatus] = useState<string>("")
  const [search, setSearch] = useState("")
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchData = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams()
      if (status) params.set("status", status)
      if (search) params.set("userId", search)
      params.set("page", String(page))
      params.set("pageSize", String(pageSize))

      const result = await apiGet<{ success: boolean; data: ListResponse }>(
        `/api/kyc/admin?${params.toString()}`
      )
      setRecords(result.data.records)
      setTotal(result.data.total)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load KYC submissions")
    } finally {
      setLoading(false)
    }
  }, [page, pageSize, status, search])

  useEffect(() => {
    void fetchData()
  }, [page, pageSize, status, fetchData])

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault()
    setPage(1)
    void fetchData()
  }

  const totalPages = Math.ceil(total / pageSize)

  return (
    <div className="min-h-screen bg-background p-6">
      <div className="mx-auto max-w-6xl">
        <h1 className="mb-2 text-3xl font-black">KYC Review Queue</h1>
        <p className="mb-8 text-muted-foreground">Review and manage KYC submissions from users</p>

        {/* Filters */}
        <div className="mb-6 flex flex-col gap-4 sm:flex-row">
          <form onSubmit={handleSearch} className="flex flex-1 gap-2">
            <div className="flex flex-1 gap-2">
              <Input
                placeholder="Search by user ID..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="border-2 border-foreground"
              />
              <Button type="submit" className="border-2 border-foreground font-bold">
                <Search className="h-4 w-4" />
              </Button>
            </div>
          </form>

          <Select value={status} onValueChange={(v) => { setStatus(v); setPage(1) }}>
            <SelectTrigger className="w-full border-2 border-foreground sm:w-48">
              <SelectValue placeholder="Filter by status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="">All Statuses</SelectItem>
              <SelectItem value="pending">Pending</SelectItem>
              <SelectItem value="in_review">In Review</SelectItem>
              <SelectItem value="approved">Approved</SelectItem>
              <SelectItem value="rejected">Rejected</SelectItem>
              <SelectItem value="expired">Expired</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Error State */}
        {error && (
          <Card className="mb-6 border-2 border-destructive bg-destructive/10 p-4">
            <p className="text-sm text-destructive">{error}</p>
          </Card>
        )}

        {/* Loading State */}
        {loading && (
          <Card className="border-2 border-foreground p-8 text-center">
            <p className="font-bold">Loading submissions...</p>
          </Card>
        )}

        {/* Table */}
        {!loading && (
          <>
            <div className="overflow-x-auto rounded border-2 border-foreground">
              <table className="w-full" aria-label="KYC submissions">
                <thead className="bg-primary">
                  <tr>
                    <th scope="col" className="px-4 py-3 text-left font-bold">User ID</th>
                    <th scope="col" className="px-4 py-3 text-left font-bold">Document Type</th>
                    <th scope="col" className="px-4 py-3 text-left font-bold">Submission Date</th>
                    <th scope="col" className="px-4 py-3 text-left font-bold">Status</th>
                    <th scope="col" className="px-4 py-3 text-left font-bold">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {records.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">
                        No submissions found
                      </td>
                    </tr>
                  ) : (
                    records.map((record) => {
                      const cfg = statusConfig[record.status]
                      return (
                        <tr key={record.id} className="border-t border-foreground">
                          <td className="px-4 py-3 font-mono text-sm">{record.userId.slice(0, 8)}...</td>
                          <td className="px-4 py-3 capitalize">{record.documentType.replace(/_/g, " ")}</td>
                          <td className="px-4 py-3 text-sm">
                            {formatDate(record.createdAt)}
                          </td>
                          <td className="px-4 py-3">
                            <Badge className={`gap-1 border-2 border-foreground ${cfg.color}`}>
                              {cfg.icon}
                              {cfg.label}
                            </Badge>
                          </td>
                          <td className="px-4 py-3">
                            <Link href={`/admin/kyc/${record.id}`}>
                              <Button variant="outline" size="sm" className="border-2 border-foreground font-bold">
                                Review
                              </Button>
                            </Link>
                          </td>
                        </tr>
                      )
                    })
                  )}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="mt-6 flex items-center justify-between">
                <p className="text-sm text-muted-foreground">
                  Showing {(page - 1) * pageSize + 1} to {Math.min(page * pageSize, total)} of {total}
                </p>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={page === 1}
                    onClick={() => setPage(p => Math.max(1, p - 1))}
                    className="border-2 border-foreground"
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                  <span className="flex items-center gap-2">
                    Page {page} of {totalPages}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={page >= totalPages}
                    onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                    className="border-2 border-foreground"
                  >
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
