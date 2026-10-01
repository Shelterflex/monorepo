'use client'

import { useState, useEffect } from 'react'
import { Download, Trash2, Upload, AlertCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { DashboardHeader } from '@/components/dashboard-header'
import { DocumentUploadModal } from '@/components/DocumentUploadModal'
import { apiGet, apiDelete } from '@/lib/apiClient'
import { formatDistanceToNow } from 'date-fns'
import { toast } from 'sonner'

type DocumentCategory = 'lease_agreement' | 'payment_receipt' | 'identity_document' | 'inspection_report' | 'other'

interface TenantDocument {
  id: string
  userId: string
  fileName: string
  fileFormat: string
  fileSizeBytes: number
  category: DocumentCategory
  description: string | null
  dealId: string | null
  isLandlordUploaded: boolean
  createdAt: string
}

interface ListResponse {
  success: boolean
  data: TenantDocument[]
  pagination: {
    page: number
    pageSize: number
    total: number
    totalPages: number
  }
}

const CATEGORY_LABELS: Record<DocumentCategory, string> = {
  lease_agreement: 'Lease Agreements',
  payment_receipt: 'Payment Receipts',
  identity_document: 'Identity Documents',
  inspection_report: 'Inspection Reports',
  other: 'Other Documents',
}

const CATEGORY_VALUES: DocumentCategory[] = [
  'lease_agreement',
  'payment_receipt',
  'identity_document',
  'inspection_report',
  'other',
]

function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i]
}

async function downloadDocument(docId: string): Promise<void> {
  try {
    const response = await apiGet<{
      success: boolean
      data: {
        documentId: string
        downloadUrl: string
        expiresInSeconds: number
      }
    }>(`/api/v1/tenant/documents/${docId}/download`)

    if (response.data?.downloadUrl) {
      window.open(response.data.downloadUrl, '_blank')
    }
  } catch (error) {
    toast.error('Failed to download document')
  }
}

export default function DocumentsPage() {
  const [documents, setDocuments] = useState<TenantDocument[]>([])
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<DocumentCategory | 'all'>('all')
  const [uploadModalOpen, setUploadModalOpen] = useState(false)

  const fetchDocuments = async (category?: DocumentCategory) => {
    setLoading(true)
    try {
      const url = category
        ? `/api/v1/tenant/documents?category=${category}`
        : '/api/v1/tenant/documents'

      const response = await apiGet<ListResponse>(url)
      setDocuments(response.data || [])
    } catch (error) {
      toast.error('Failed to load documents')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    const category = activeTab === 'all' ? undefined : activeTab
    fetchDocuments(category)
  }, [activeTab])

  const handleDelete = async (docId: string, fileName: string) => {
    if (!window.confirm(`Delete "${fileName}"?`)) return

    try {
      await apiDelete(`/api/v1/tenant/documents/${docId}`)
      toast.success('Document deleted')
      const category = activeTab === 'all' ? undefined : activeTab
      fetchDocuments(category)
    } catch (error) {
      toast.error('Failed to delete document')
    }
  }

  const handleUploadSuccess = () => {
    setUploadModalOpen(false)
    const category = activeTab === 'all' ? undefined : activeTab
    fetchDocuments(category)
  }

  const filteredDocs = activeTab === 'all' ? documents : documents.filter((d) => d.category === activeTab)

  return (
    <div className="min-h-screen bg-background">
      <DashboardHeader />

      <main id="main-content" className="container max-w-6xl mx-auto px-4 py-8">
        <div className="mb-8">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h1 className="text-3xl font-bold text-foreground">Document Vault</h1>
              <p className="text-muted-foreground mt-2">Upload and manage your important documents</p>
            </div>
            <Button
              onClick={() => setUploadModalOpen(true)}
              className="gap-2 bg-foreground text-background hover:bg-foreground/90"
            >
              <Upload className="h-4 w-4" />
              Upload Document
            </Button>
          </div>

          {/* Tabs */}
          <div className="flex gap-2 overflow-x-auto border-b border-border">
            <button
              onClick={() => setActiveTab('all')}
              className={`px-4 py-3 font-medium border-b-2 whitespace-nowrap transition-colors ${
                activeTab === 'all'
                  ? 'border-foreground text-foreground'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
            >
              All Documents
            </button>
            {CATEGORY_VALUES.map((cat) => (
              <button
                key={cat}
                onClick={() => setActiveTab(cat)}
                className={`px-4 py-3 font-medium border-b-2 whitespace-nowrap transition-colors ${
                  activeTab === cat
                    ? 'border-foreground text-foreground'
                    : 'border-transparent text-muted-foreground hover:text-foreground'
                }`}
              >
                {CATEGORY_LABELS[cat]}
              </button>
            ))}
          </div>
        </div>

        {/* Documents List */}
        <div className="space-y-4">
          {loading ? (
            <div className="text-center py-12">
              <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-border border-t-foreground" />
            </div>
          ) : filteredDocs.length === 0 ? (
            <Card className="border-2 border-border p-8 text-center">
              <AlertCircle className="h-8 w-8 text-muted-foreground mx-auto mb-4" />
              <p className="text-muted-foreground">No documents in this category yet</p>
            </Card>
          ) : (
            <div className="space-y-3">
              {filteredDocs.map((doc) => (
                <Card
                  key={doc.id}
                  className="border-2 border-border p-4 flex items-center justify-between hover:shadow-[4px_4px_0px_0px_rgba(26,26,26,1)] transition-shadow"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start gap-3">
                      <div className="flex-1">
                        <h3 className="font-bold text-foreground break-words">{doc.fileName}</h3>
                        <div className="flex gap-3 mt-2 text-sm text-muted-foreground flex-wrap">
                          <span>{formatFileSize(doc.fileSizeBytes)}</span>
                          <span>•</span>
                          <span>{formatDistanceToNow(new Date(doc.createdAt), { addSuffix: true })}</span>
                          {doc.isLandlordUploaded && (
                            <>
                              <span>•</span>
                              <span className="font-medium text-foreground">Landlord uploaded</span>
                            </>
                          )}
                        </div>
                        {doc.description && (
                          <p className="text-sm text-muted-foreground mt-2 break-words">{doc.description}</p>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="flex gap-2 ml-4 flex-shrink-0">
                    <Button
                      onClick={() => downloadDocument(doc.id)}
                      variant="outline"
                      size="sm"
                      className="border-2 border-border"
                    >
                      <Download className="h-4 w-4" />
                    </Button>
                    {!doc.isLandlordUploaded && (
                      <Button
                        onClick={() => handleDelete(doc.id, doc.fileName)}
                        variant="destructive"
                        size="sm"
                        className="border-2"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                </Card>
              ))}
            </div>
          )}
        </div>
      </main>

      <DocumentUploadModal
        open={uploadModalOpen}
        onOpenChange={setUploadModalOpen}
        onSuccess={handleUploadSuccess}
      />
    </div>
  )
}
