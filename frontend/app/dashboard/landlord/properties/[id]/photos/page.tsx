'use client'

import Link from 'next/link'
import { useParams } from 'next/navigation'
import { useEffect, useMemo, useState } from 'react'
import { ArrowLeft, Loader2, Save } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import {
  PhotoGalleryEditor,
  type ListingPhoto,
} from '@/components/landlord/PhotoGalleryEditor'
import {
  getLandlordProperty,
  updateLandlordProperty,
  type LandlordPropertyRecord,
} from '@/lib/landlordPropertiesApi'
import { showErrorToast, showSuccessToast } from '@/lib/toast'

/**
 * Real property photo management (issue #1848).
 *
 * Photos are loaded from the landlord property record and edited with the
 * same `PhotoGalleryEditor` the listing form uses, so uploads, deletes and
 * reordering persist against the backend instead of being discarded. New
 * files are uploaded by the editor itself (it knows `propertyId`); reorder
 * and primary-photo changes are persisted through `updateLandlordProperty`
 * with the same payload shape the listing form submits.
 */
export default function PropertyPhotosPage() {
  const params = useParams()
  const id = params.id as string

  const [property, setProperty] = useState<LandlordPropertyRecord | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [photos, setPhotos] = useState<ListingPhoto[]>([])
  const [primaryPhotoId, setPrimaryPhotoId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let cancelled = false
    getLandlordProperty(id)
      .then((data) => {
        if (cancelled) return
        setProperty(data)
        setPhotos(
          data.photos.map((url, index) => ({
            id: `existing-${index}`,
            preview: url,
          })),
        )
        setPrimaryPhotoId(
          data.photos.length > 0 ? `existing-${data.primaryPhotoIndex ?? 0}` : null,
        )
      })
      .catch((error) => {
        if (!cancelled) showErrorToast(error, 'Failed to load property photos')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [id])

  /** Mirror the listing form's payload convention: primary photo first. */
  const buildPhotoPayload = () => {
    // Photos still holding a File failed to upload; keep them out of the
    // persisted list so blob: previews never reach the backend.
    const persisted = photos.filter((photo) => !photo.file)
    const ordered = [...persisted]
    const primaryIndex = primaryPhotoId
      ? ordered.findIndex((photo) => photo.id === primaryPhotoId)
      : 0
    if (primaryIndex > 0) {
      const [primary] = ordered.splice(primaryIndex, 1)
      ordered.unshift(primary)
    }
    return {
      photos: ordered.map((photo) => photo.preview),
      primaryPhotoIndex: 0,
    }
  }

  const handleSave = async () => {
    if (!property) return
    setSaving(true)
    try {
      const payload = buildPhotoPayload()
      const updated = await updateLandlordProperty(property.id, payload)
      // Re-sync with the record so local ids match the persisted state.
      setProperty(updated)
      setPhotos(
        updated.photos.map((url, index) => ({
          id: `existing-${index}`,
          preview: url,
        })),
      )
      setPrimaryPhotoId(
        updated.photos.length > 0 ? `existing-${updated.primaryPhotoIndex ?? 0}` : null,
      )
      showSuccessToast('Property photos updated')
    } catch (error) {
      showErrorToast(error, 'Failed to save property photos')
    } finally {
      setSaving(false)
    }
  }

  const unsavedUploads = useMemo(
    () => photos.filter((photo) => photo.file).length,
    [photos],
  )

  return (
    <div className="min-h-screen bg-background pt-20">
      <div className="mx-auto max-w-4xl p-8">
        <Link
          href="/dashboard/landlord/properties"
          className="mb-4 inline-flex items-center gap-2 font-bold hover:text-primary"
        >
          <ArrowLeft className="h-5 w-5" />
          Back to properties
        </Link>
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-4xl font-bold">Property Photos</h1>
            {property && (
              <p className="text-muted-foreground">
                Manage photos for {property.title}
              </p>
            )}
          </div>
          <Button onClick={handleSave} disabled={saving || !property}>
            {saving ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Save className="mr-2 h-4 w-4" />
            )}
            {saving ? 'Saving…' : 'Save photos'}
          </Button>
        </div>

        <div className="mt-8">
          {loading ? (
            <Skeleton className="h-96 w-full" />
          ) : (
            <>
              <PhotoGalleryEditor
                propertyId={id}
                photos={photos}
                primaryPhotoId={primaryPhotoId}
                onChange={(nextPhotos, nextPrimaryId) => {
                  setPhotos(nextPhotos)
                  setPrimaryPhotoId(nextPrimaryId)
                }}
              />
              {unsavedUploads > 0 && (
                <p className="mt-2 text-sm text-destructive">
                  {unsavedUploads} photo{unsavedUploads > 1 ? 's' : ''} failed to
                  upload — use the retry button on those photos before saving.
                </p>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
