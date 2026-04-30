'use client'

import React from 'react'
import { PhotoGallery } from '@/components/properties/PhotoGallery'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { ArrowLeft } from 'lucide-react'
import Link from 'next/link'

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

export default function PropertyPhotosPage({ params }: { params: { id: string } }) {
  // In a real implementation, you would fetch photos from the backend API
  const mockPhotos: PropertyPhoto[] = [
    {
      id: '1',
      url: 'https://images.unsplash.com/photo-1560448204-e02f11c3d0e2?w=800',
      orderIndex: 0,
      isFeatured: true,
      fileName: 'living-room.jpg',
      fileSize: 2048000,
      width: 1920,
      height: 1080,
      mimeType: 'image/jpeg',
      uploadedAt: new Date('2024-01-15'),
    },
    {
      id: '2',
      url: 'https://images.unsplash.com/photo-1522708323590-d24dbb6b0267?w=800',
      orderIndex: 1,
      isFeatured: false,
      fileName: 'bedroom.jpg',
      fileSize: 1536000,
      width: 1920,
      height: 1080,
      mimeType: 'image/jpeg',
      uploadedAt: new Date('2024-01-16'),
    },
    {
      id: '3',
      url: 'https://images.unsplash.com/photo-1556911220-e15b29be8c8f?w=800',
      orderIndex: 2,
      isFeatured: false,
      fileName: 'kitchen.jpg',
      fileSize: 1792000,
      width: 1920,
      height: 1080,
      mimeType: 'image/jpeg',
      uploadedAt: new Date('2024-01-17'),
    },
  ]

  const handlePhotosChange = (photos: PropertyPhoto[]) => {
    console.log('Photos changed:', photos)
    // In a real implementation, sync with backend
  }

  return (
    <div className="container mx-auto py-8 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link href="/dashboard/landlord/properties">
            <Button variant="ghost" size="icon">
              <ArrowLeft className="w-5 h-5" />
            </Button>
          </Link>
          <div>
            <h1 className="text-2xl font-bold">Property Photos</h1>
            <p className="text-muted-foreground">Manage photos for property #{params.id}</p>
          </div>
        </div>
      </div>

      {/* Photo Gallery */}
      <PhotoGallery
        propertyId={params.id}
        initialPhotos={mockPhotos}
        onPhotosChange={handlePhotosChange}
        readOnly={false}
      />

      {/* Usage Instructions */}
      <Card className="p-6">
        <h2 className="text-lg font-semibold mb-4">How to Use</h2>
        <ul className="space-y-2 text-sm text-muted-foreground">
          <li>• <strong>Upload:</strong> Click "Upload Photos" to add new images (max 10MB per file)</li>
          <li>• <strong>Drag & Drop:</strong> Drag photos to reorder them in the gallery</li>
          <li>• <strong>Featured:</strong> Click the star icon to set a photo as featured</li>
          <li>• <strong>View:</strong> Click any photo to open the lightbox viewer</li>
          <li>• <strong>Navigate:</strong> Use arrow keys or click the arrows to navigate in lightbox</li>
          <li>• <strong>Delete:</strong> Click the trash icon to remove a photo (with undo option)</li>
        </ul>
      </Card>
    </div>
  )
}
