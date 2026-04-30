'use client'

import React, { useState, useCallback, useRef, useEffect } from 'react'
import { Image as ImageIcon, Star, Trash2, GripVertical, X, Upload, ChevronLeft, ChevronRight, Info } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'

interface PropertyPhoto {
  id: string
  url: string
  orderIndex: number
  isFeatured: boolean
  fileName?: string
  fileSize?: number
  width?: number
  height?: number
  mimeType?: string
  uploadedAt: Date
}

interface PhotoGalleryProps {
  propertyId: string
  initialPhotos?: PropertyPhoto[]
  onPhotosChange?: (photos: PropertyPhoto[]) => void
  readOnly?: boolean
}

export function PhotoGallery({ propertyId, initialPhotos = [], onPhotosChange, readOnly = false }: PhotoGalleryProps) {
  const [photos, setPhotos] = useState<PropertyPhoto[]>(initialPhotos)
  const [selectedPhoto, setSelectedPhoto] = useState<PropertyPhoto | null>(null)
  const [lightboxOpen, setLightboxOpen] = useState(false)
  const [uploadProgress, setUploadProgress] = useState<Record<string, number>>({})
  const [uploadErrors, setUploadErrors] = useState<Record<string, string>>({})
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [photoToDelete, setPhotoToDelete] = useState<PropertyPhoto | null>(null)
  const [recentlyDeleted, setRecentlyDeleted] = useState<PropertyPhoto[]>([])
  const [draggedItem, setDraggedItem] = useState<string | null>(null)
  const [dragOverItem, setDragOverItem] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Sync photos with parent component
  useEffect(() => {
    if (onPhotosChange) {
      onPhotosChange(photos)
    }
  }, [photos, onPhotosChange])

  const handleFileSelect = useCallback(async (files: FileList | null) => {
    if (!files || files.length === 0) return

    const fileArray = Array.from(files)
    const validFiles = fileArray.filter(file => file.type.startsWith('image/'))

    if (validFiles.length === 0) {
      toast.error('Please select valid image files')
      return
    }

    if (validFiles.length !== fileArray.length) {
      toast.warning(`${fileArray.length - validFiles.length} non-image files were skipped`)
    }

    for (const file of validFiles) {
      const fileId = `${Date.now()}-${file.name}`
      setUploadProgress(prev => ({ ...prev, [fileId]: 0 }))

      try {
        // Simulate upload progress
        for (let progress = 0; progress <= 100; progress += 10) {
          await new Promise(resolve => setTimeout(resolve, 50))
          setUploadProgress(prev => ({ ...prev, [fileId]: progress }))
        }

        // In a real implementation, you would upload to the backend here
        // For now, we'll create a local preview
        const reader = new FileReader()
        reader.onload = (e) => {
          const newPhoto: PropertyPhoto = {
            id: fileId,
            url: e.target?.result as string,
            orderIndex: photos.length,
            isFeatured: photos.length === 0, // First photo is featured by default
            fileName: file.name,
            fileSize: file.size,
            mimeType: file.type,
            uploadedAt: new Date(),
          }

          setPhotos(prev => [...prev, newPhoto])
          setUploadProgress(prev => {
            const { [fileId]: _, ...rest } = prev
            return rest
          })
          toast.success(`Uploaded ${file.name}`)
        }
        reader.readAsDataURL(file)
      } catch (error) {
        setUploadErrors(prev => ({ ...prev, [fileId]: 'Upload failed' }))
        setUploadProgress(prev => {
          const { [fileId]: _, ...rest } = prev
          return rest
        })
        toast.error(`Failed to upload ${file.name}`)
      }
    }
  }, [photos.length])

  const handleDragStart = useCallback((e: React.DragEvent, photoId: string) => {
    if (readOnly) return
    setDraggedItem(photoId)
    e.dataTransfer.effectAllowed = 'move'
  }, [readOnly])

  const handleDragOver = useCallback((e: React.DragEvent, photoId: string) => {
    if (readOnly) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setDragOverItem(photoId)
  }, [readOnly])

  const handleDragEnd = useCallback(() => {
    setDraggedItem(null)
    setDragOverItem(null)
  }, [])

  const handleDrop = useCallback((e: React.DragEvent, targetPhotoId: string) => {
    e.preventDefault()
    if (readOnly || !draggedItem || draggedItem === targetPhotoId) return

    const draggedIndex = photos.findIndex(p => p.id === draggedItem)
    const targetIndex = photos.findIndex(p => p.id === targetPhotoId)

    if (draggedIndex === -1 || targetIndex === -1) return

    const newPhotos = [...photos]
    const [draggedPhoto] = newPhotos.splice(draggedIndex, 1)
    newPhotos.splice(targetIndex, 0, draggedPhoto)

    // Update order indices
    const reorderedPhotos = newPhotos.map((photo, index) => ({
      ...photo,
      orderIndex: index,
    }))

    setPhotos(reorderedPhotos)
    setDraggedItem(null)
    setDragOverItem(null)
    toast.success('Photos reordered')
  }, [draggedItem, photos, readOnly])

  const handleSetFeatured = useCallback(async (photoId: string) => {
    if (readOnly) return

    setPhotos(prev => prev.map(photo => ({
      ...photo,
      isFeatured: photo.id === photoId,
    })))

    // In a real implementation, call the backend API
    toast.success('Featured photo updated')
  }, [readOnly])

  const handleDeleteClick = useCallback((photo: PropertyPhoto) => {
    if (readOnly) return
    setPhotoToDelete(photo)
    setDeleteDialogOpen(true)
  }, [readOnly])

  const handleDeleteConfirm = useCallback(() => {
    if (!photoToDelete) return

    setPhotos(prev => prev.filter(p => p.id !== photoToDelete.id))
    setRecentlyDeleted(prev => [photoToDelete, ...prev].slice(0, 5)) // Keep last 5 deleted
    setDeleteDialogOpen(false)
    setPhotoToDelete(null)

    // In a real implementation, call the backend API
    toast.success('Photo deleted', {
      action: {
        label: 'Undo',
        onClick: () => {
          setRecentlyDeleted(prev => prev.filter(p => p.id !== photoToDelete.id))
          setPhotos(prev => [...prev, photoToDelete].sort((a, b) => a.orderIndex - b.orderIndex))
          toast.success('Photo restored')
        },
      },
    })
  }, [photoToDelete])

  const handleLightboxOpen = useCallback((photo: PropertyPhoto) => {
    setSelectedPhoto(photo)
    setLightboxOpen(true)
  }, [])

  const handleLightboxClose = useCallback(() => {
    setLightboxOpen(false)
    setSelectedPhoto(null)
  }, [])

  const handleLightboxNext = useCallback(() => {
    if (!selectedPhoto) return
    const currentIndex = photos.findIndex(p => p.id === selectedPhoto.id)
    const nextIndex = (currentIndex + 1) % photos.length
    setSelectedPhoto(photos[nextIndex])
  }, [selectedPhoto, photos])

  const handleLightboxPrev = useCallback(() => {
    if (!selectedPhoto) return
    const currentIndex = photos.findIndex(p => p.id === selectedPhoto.id)
    const prevIndex = (currentIndex - 1 + photos.length) % photos.length
    setSelectedPhoto(photos[prevIndex])
  }, [selectedPhoto, photos])

  // Keyboard navigation for lightbox
  useEffect(() => {
    if (!lightboxOpen) return

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        handleLightboxClose()
      } else if (e.key === 'ArrowRight') {
        handleLightboxNext()
      } else if (e.key === 'ArrowLeft') {
        handleLightboxPrev()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [lightboxOpen, handleLightboxClose, handleLightboxNext, handleLightboxPrev])

  const sortedPhotos = [...photos].sort((a, b) => a.orderIndex - b.orderIndex)
  const featuredPhoto = sortedPhotos.find(p => p.isFeatured)

  return (
    <div className="space-y-4">
      {/* Upload Section */}
      {!readOnly && (
        <Card className="p-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-lg font-semibold">Property Photos</h3>
              <p className="text-sm text-muted-foreground">
                {sortedPhotos.length} photo{sortedPhotos.length !== 1 ? 's' : ''} • Max 10MB per file
              </p>
            </div>
            <Button
              onClick={() => fileInputRef.current?.click()}
              disabled={Object.keys(uploadProgress).length > 0}
            >
              <Upload className="w-4 h-4 mr-2" />
              Upload Photos
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept="image/*"
              className="hidden"
              onChange={(e) => handleFileSelect(e.target.files)}
            />
          </div>

          {/* Upload Progress */}
          {Object.keys(uploadProgress).length > 0 && (
            <div className="space-y-2">
              {Object.entries(uploadProgress).map(([fileId, progress]) => (
                <div key={fileId} className="flex items-center gap-4">
                  <Progress value={progress} className="flex-1" />
                  <span className="text-sm text-muted-foreground">{progress}%</span>
                </div>
              ))}
            </div>
          )}

          {/* Upload Errors */}
          {Object.keys(uploadErrors).length > 0 && (
            <div className="space-y-2 mt-4">
              {Object.entries(uploadErrors).map(([fileId, error]) => (
                <div key={fileId} className="flex items-center gap-2 text-sm text-destructive">
                  <X className="w-4 h-4" />
                  <span>{error}</span>
                </div>
              ))}
            </div>
          )}
        </Card>
      )}

      {/* Photo Grid */}
      {sortedPhotos.length > 0 ? (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {sortedPhotos.map((photo) => (
            <PhotoCard
              key={photo.id}
              photo={photo}
              isFeatured={photo.isFeatured}
              isDragging={draggedItem === photo.id}
              isDragOver={dragOverItem === photo.id}
              onDragStart={handleDragStart}
              onDragOver={handleDragOver}
              onDragEnd={handleDragEnd}
              onDrop={handleDrop}
              onClick={() => handleLightboxOpen(photo)}
              onSetFeatured={() => handleSetFeatured(photo.id)}
              onDelete={() => handleDeleteClick(photo)}
              readOnly={readOnly}
            />
          ))}
        </div>
      ) : (
        <Card className="p-12 text-center">
          <ImageIcon className="w-16 h-16 mx-auto mb-4 text-muted-foreground" />
          <h3 className="text-lg font-semibold mb-2">No photos yet</h3>
          <p className="text-sm text-muted-foreground mb-4">
            Upload photos to showcase your property
          </p>
          {!readOnly && (
            <Button
              onClick={() => fileInputRef.current?.click()}
              variant="outline"
            >
              <Upload className="w-4 h-4 mr-2" />
              Upload Your First Photo
            </Button>
          )}
        </Card>
      )}

      {/* Lightbox */}
      <Lightbox
        isOpen={lightboxOpen}
        photo={selectedPhoto}
        photos={sortedPhotos}
        onClose={handleLightboxClose}
        onNext={handleLightboxNext}
        onPrev={handleLightboxPrev}
      />

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Photo?</AlertDialogTitle>
            <AlertDialogDescription>
              This action cannot be undone. The photo will be permanently removed from your property gallery.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteConfirm} className="bg-destructive text-destructive-foreground">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

interface PhotoCardProps {
  photo: PropertyPhoto
  isFeatured: boolean
  isDragging: boolean
  isDragOver: boolean
  onDragStart: (e: React.DragEvent, id: string) => void
  onDragOver: (e: React.DragEvent, id: string) => void
  onDragEnd: () => void
  onDrop: (e: React.DragEvent, id: string) => void
  onClick: () => void
  onSetFeatured: () => void
  onDelete: () => void
  readOnly: boolean
}

function PhotoCard({
  photo,
  isFeatured,
  isDragging,
  isDragOver,
  onDragStart,
  onDragOver,
  onDragEnd,
  onDrop,
  onClick,
  onSetFeatured,
  onDelete,
  readOnly,
}: PhotoCardProps) {
  const [showActions, setShowActions] = useState(false)

  return (
    <Card
      className={cn(
        'relative overflow-hidden group cursor-pointer transition-all',
        isDragging && 'opacity-50',
        isDragOver && 'ring-2 ring-primary'
      )}
      draggable={!readOnly}
      onDragStart={(e) => onDragStart(e, photo.id)}
      onDragOver={(e) => onDragOver(e, photo.id)}
      onDragEnd={onDragEnd}
      onDrop={(e) => onDrop(e, photo.id)}
      onClick={onClick}
      onMouseEnter={() => setShowActions(true)}
      onMouseLeave={() => setShowActions(false)}
    >
      {/* Image */}
      <div className="aspect-square relative">
        <img
          src={photo.url}
          alt={photo.fileName || 'Property photo'}
          className="w-full h-full object-cover"
        />
        
        {/* Featured Badge */}
        {isFeatured && (
          <Badge className="absolute top-2 left-2 bg-yellow-500 hover:bg-yellow-600">
            <Star className="w-3 h-3 mr-1" />
            Featured
          </Badge>
        )}

        {/* Overlay Actions */}
        <div
          className={cn(
            'absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity',
            'flex items-center justify-center gap-2'
          )}
        >
          {!readOnly && (
            <>
              <Button
                size="sm"
                variant="secondary"
                onClick={(e) => {
                  e.stopPropagation()
                  onSetFeatured()
                }}
                className={cn(isFeatured && 'bg-yellow-500 hover:bg-yellow-600 text-white')}
              >
                <Star className="w-4 h-4" />
              </Button>
              <Button
                size="sm"
                variant="destructive"
                onClick={(e) => {
                  e.stopPropagation()
                  onDelete()
                }}
              >
                <Trash2 className="w-4 h-4" />
              </Button>
            </>
          )}
          <Button size="sm" variant="secondary">
            <Info className="w-4 h-4" />
          </Button>
        </div>

        {/* Drag Handle */}
        {!readOnly && (
          <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
            <GripVertical className="w-5 h-5 text-white cursor-move" />
          </div>
        )}
      </div>

      {/* File Info */}
      <div className="p-2 text-xs text-muted-foreground truncate">
        {photo.fileName || 'Untitled'}
      </div>
    </Card>
  )
}

interface LightboxProps {
  isOpen: boolean
  photo: PropertyPhoto | null
  photos: PropertyPhoto[]
  onClose: () => void
  onNext: () => void
  onPrev: () => void
}

function Lightbox({ isOpen, photo, photos, onClose, onNext, onPrev }: LightboxProps) {
  if (!isOpen || !photo) return null

  const currentIndex = photos.findIndex(p => p.id === photo.id)

  return (
    <div className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center">
      {/* Close Button */}
      <Button
        variant="ghost"
        size="icon"
        className="absolute top-4 right-4 text-white hover:bg-white/20"
        onClick={onClose}
      >
        <X className="w-6 h-6" />
      </Button>

      {/* Navigation */}
      {photos.length > 1 && (
        <>
          <Button
            variant="ghost"
            size="icon"
            className="absolute left-4 text-white hover:bg-white/20"
            onClick={onPrev}
            disabled={photos.length <= 1}
          >
            <ChevronLeft className="w-8 h-8" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="absolute right-4 text-white hover:bg-white/20"
            onClick={onNext}
            disabled={photos.length <= 1}
          >
            <ChevronRight className="w-8 h-8" />
          </Button>
        </>
      )}

      {/* Image */}
      <div className="max-w-4xl max-h-[80vh] p-4">
        <img
          src={photo.url}
          alt={photo.fileName || 'Property photo'}
          className="max-w-full max-h-full object-contain"
        />
      </div>

      {/* Photo Info */}
      <div className="absolute bottom-4 left-4 right-4 bg-black/70 text-white p-4 rounded-lg">
        <div className="flex items-center justify-between">
          <div>
            <p className="font-semibold">{photo.fileName || 'Untitled'}</p>
            <p className="text-sm text-gray-300">
              {photo.width && photo.height && `${photo.width} × ${photo.height} • `}
              {photo.fileSize && formatFileSize(photo.fileSize)}
            </p>
          </div>
          {photos.length > 1 && (
            <Badge variant="secondary">
              {currentIndex + 1} / {photos.length}
            </Badge>
          )}
        </div>
      </div>

      {/* Keyboard Hint */}
      <div className="absolute bottom-20 left-1/2 -translate-x-1/2 text-white/50 text-sm">
        Use arrow keys to navigate, Escape to close
      </div>
    </div>
  )
}

function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 Bytes'
  const k = 1024
  const sizes = ['Bytes', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i]
}
