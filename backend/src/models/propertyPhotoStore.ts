import { randomUUID } from 'node:crypto'
import { getPool, type PgPoolLike } from '../db.js'
import {
  PropertyPhoto,
  CreatePhotoInput,
  UpdatePhotoInput,
  PhotoFilters,
  ReorderPhotosInput,
} from './propertyPhoto.js'

interface PropertyPhotoStorePort {
  create(input: CreatePhotoInput): Promise<PropertyPhoto>
  getById(id: string): Promise<PropertyPhoto | null>
  list(filters?: PhotoFilters): Promise<PropertyPhoto[]>
  update(id: string, input: UpdatePhotoInput): Promise<PropertyPhoto | null>
  delete(id: string): Promise<boolean>
  reorder(input: ReorderPhotosInput): Promise<PropertyPhoto[]>
  setFeatured(photoId: string, propertyId: string): Promise<PropertyPhoto>
  clear(): Promise<void>
}

class InMemoryPropertyPhotoStore implements PropertyPhotoStorePort {
  private photos = new Map<string, PropertyPhoto>()

  async create(input: CreatePhotoInput): Promise<PropertyPhoto> {
    const now = new Date()
    const photo: PropertyPhoto = {
      id: randomUUID(),
      propertyId: input.propertyId,
      url: input.url,
      orderIndex: input.orderIndex ?? 0,
      isFeatured: input.isFeatured ?? false,
      fileName: input.fileName,
      fileSize: input.fileSize,
      width: input.width,
      height: input.height,
      mimeType: input.mimeType,
      uploadedAt: now,
      createdAt: now,
      updatedAt: now,
    }

    this.photos.set(photo.id, photo)
    return photo
  }

  async getById(id: string): Promise<PropertyPhoto | null> {
    return this.photos.get(id) ?? null
  }

  async list(filters: PhotoFilters = {}): Promise<PropertyPhoto[]> {
    let filtered = Array.from(this.photos.values())

    if (filters.propertyId) {
      filtered = filtered.filter((p) => p.propertyId === filters.propertyId)
    }

    if (filters.isFeatured !== undefined) {
      filtered = filtered.filter((p) => p.isFeatured === filters.isFeatured)
    }

    filtered.sort((a, b) => a.orderIndex - b.orderIndex)
    return filtered
  }

  async update(id: string, input: UpdatePhotoInput): Promise<PropertyPhoto | null> {
    const photo = this.photos.get(id)
    if (!photo) return null

    const updated: PropertyPhoto = {
      ...photo,
      ...input,
      updatedAt: new Date(),
    }

    this.photos.set(id, updated)
    return updated
  }

  async delete(id: string): Promise<boolean> {
    return this.photos.delete(id)
  }

  async reorder(input: ReorderPhotosInput): Promise<PropertyPhoto[]> {
    const photo = this.photos.get(input.photoId)
    if (!photo) return []

    const propertyPhotos = Array.from(this.photos.values())
      .filter((p) => p.propertyId === photo.propertyId)
      .sort((a, b) => a.orderIndex - b.orderIndex)

    // Remove the photo from its current position
    const currentIndex = propertyPhotos.findIndex((p) => p.id === input.photoId)
    if (currentIndex === -1) return []

    const [movedPhoto] = propertyPhotos.splice(currentIndex, 1)
    
    // Insert at new position
    propertyPhotos.splice(input.newOrderIndex, 0, movedPhoto)

    // Update order indices
    propertyPhotos.forEach((p, index) => {
      p.orderIndex = index
      this.photos.set(p.id, p)
    })

    return propertyPhotos
  }

  async setFeatured(photoId: string, propertyId: string): Promise<PropertyPhoto> {
    // Unset featured for all photos in the property
    const propertyPhotos = Array.from(this.photos.values()).filter((p) => p.propertyId === propertyId)
    propertyPhotos.forEach((p) => {
      p.isFeatured = false
      this.photos.set(p.id, p)
    })

    // Set featured for the specified photo
    const photo = this.photos.get(photoId)
    if (!photo) {
      throw new Error('Photo not found')
    }
    photo.isFeatured = true
    photo.updatedAt = new Date()
    this.photos.set(photoId, photo)

    return photo
  }

  async clear(): Promise<void> {
    this.photos.clear()
  }
}

type PropertyPhotoRow = {
  id: string
  property_id: string
  url: string
  order_index: number
  is_featured: boolean
  file_name: string | null
  file_size: number | null
  width: number | null
  height: number | null
  mime_type: string | null
  uploaded_at: Date
  created_at: Date
  updated_at: Date
}

class PostgresPropertyPhotoStore implements PropertyPhotoStorePort {
  private async pool(): Promise<PgPoolLike> {
    const pool = await getPool()
    if (!pool) {
      throw new Error('Database pool is not available')
    }
    return pool
  }

  async isAvailable(): Promise<boolean> {
    return (await getPool()) !== null
  }

  async create(input: CreatePhotoInput): Promise<PropertyPhoto> {
    const pool = await this.pool()
    const id = randomUUID()
    
    // Get the next order index if not provided
    let orderIndex = input.orderIndex ?? 0
    if (input.orderIndex === undefined) {
      const { rows } = await pool.query(
        'SELECT COALESCE(MAX(order_index), -1) + 1 as next_order FROM property_photos WHERE property_id = $1',
        [input.propertyId]
      )
      orderIndex = Number(rows[0].next_order)
    }

    const { rows } = await pool.query(
      `INSERT INTO property_photos (
        id, property_id, url, order_index, is_featured, 
        file_name, file_size, width, height, mime_type
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      RETURNING *`,
      [
        id,
        input.propertyId,
        input.url,
        orderIndex,
        input.isFeatured ?? false,
        input.fileName ?? null,
        input.fileSize ?? null,
        input.width ?? null,
        input.height ?? null,
        input.mimeType ?? null,
      ],
    )

    return this.mapRow(rows[0] as PropertyPhotoRow)
  }

  async getById(id: string): Promise<PropertyPhoto | null> {
    const pool = await this.pool()
    const { rows } = await pool.query(
      'SELECT * FROM property_photos WHERE id = $1',
      [id],
    )

    if (rows.length === 0) return null
    return this.mapRow(rows[0] as PropertyPhotoRow)
  }

  async list(filters: PhotoFilters = {}): Promise<PropertyPhoto[]> {
    const pool = await this.pool()
    const where: string[] = []
    const values: unknown[] = []

    if (filters.propertyId) {
      values.push(filters.propertyId)
      where.push(`property_id = $${values.length}`)
    }

    if (filters.isFeatured !== undefined) {
      values.push(filters.isFeatured)
      where.push(`is_featured = $${values.length}`)
    }

    const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : ''

    const { rows } = await pool.query(
      `SELECT * FROM property_photos ${whereClause} ORDER BY order_index ASC`,
      values,
    )

    return rows.map((row) => this.mapRow(row as PropertyPhotoRow))
  }

  async update(id: string, input: UpdatePhotoInput): Promise<PropertyPhoto | null> {
    const pool = await this.pool()
    const updates: string[] = []
    const values: unknown[] = [id]
    
    let paramIdx = 2
    Object.entries(input).forEach(([key, value]) => {
      if (value !== undefined) {
        const dbKey = key === 'orderIndex' ? 'order_index' : 
                      key === 'isFeatured' ? 'is_featured' : 
                      key === 'fileName' ? 'file_name' :
                      key === 'fileSize' ? 'file_size' :
                      key === 'mimeType' ? 'mime_type' : key
        updates.push(`${dbKey} = $${paramIdx}`)
        values.push(value)
        paramIdx++
      }
    })

    if (updates.length === 0) return this.getById(id)

    const { rows } = await pool.query(
      `UPDATE property_photos
       SET ${updates.join(', ')}, updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      values,
    )

    if (rows.length === 0) return null
    return this.mapRow(rows[0] as PropertyPhotoRow)
  }

  async delete(id: string): Promise<boolean> {
    const pool = await this.pool()
    const { rowCount } = await pool.query(
      'DELETE FROM property_photos WHERE id = $1',
      [id],
    )
    return rowCount > 0
  }

  async reorder(input: ReorderPhotosInput): Promise<PropertyPhoto[]> {
    const pool = await this.pool()
    
    // Get the photo and its property
    const photo = await this.getById(input.photoId)
    if (!photo) return []

    // Get all photos for the property
    const allPhotos = await this.list({ propertyId: photo.propertyId })
    
    // Find current index
    const currentIndex = allPhotos.findIndex((p) => p.id === input.photoId)
    if (currentIndex === -1) return []

    // Create new order
    const newOrder = [...allPhotos]
    const [movedPhoto] = newOrder.splice(currentIndex, 1)
    newOrder.splice(input.newOrderIndex, 0, movedPhoto)

    // Update all order indices in a transaction
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      
      for (let i = 0; i < newOrder.length; i++) {
        await client.query(
          'UPDATE property_photos SET order_index = $1, updated_at = NOW() WHERE id = $2',
          [i, newOrder[i].id]
        )
      }
      
      await client.query('COMMIT')
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }

    return await this.list({ propertyId: photo.propertyId })
  }

  async setFeatured(photoId: string, propertyId: string): Promise<PropertyPhoto> {
    const pool = await this.pool()
    
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      
      // Unset featured for all photos in the property
      await client.query(
        'UPDATE property_photos SET is_featured = FALSE, updated_at = NOW() WHERE property_id = $1',
        [propertyId]
      )
      
      // Set featured for the specified photo
      const { rows } = await client.query(
        'UPDATE property_photos SET is_featured = TRUE, updated_at = NOW() WHERE id = $1 RETURNING *',
        [photoId]
      )
      
      await client.query('COMMIT')
      
      if (rows.length === 0) {
        throw new Error('Photo not found')
      }
      
      return this.mapRow(rows[0] as PropertyPhotoRow)
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
  }

  async clear(): Promise<void> {
    const pool = await this.pool()
    if (process.env.NODE_ENV !== 'test') {
      throw new Error('propertyPhotoStore.clear() is only supported in test env')
    }
    await pool.query('TRUNCATE property_photos RESTART IDENTITY CASCADE')
  }

  private mapRow(row: PropertyPhotoRow): PropertyPhoto {
    return {
      id: row.id,
      propertyId: row.property_id,
      url: row.url,
      orderIndex: row.order_index,
      isFeatured: row.is_featured,
      fileName: row.file_name ?? undefined,
      fileSize: row.file_size ?? undefined,
      width: row.width ?? undefined,
      height: row.height ?? undefined,
      mimeType: row.mime_type ?? undefined,
      uploadedAt: new Date(row.uploaded_at),
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    }
  }
}

class HybridPropertyPhotoStore implements PropertyPhotoStorePort {
  private memory = new InMemoryPropertyPhotoStore()
  private postgres = new PostgresPropertyPhotoStore()

  private async adapter(): Promise<PropertyPhotoStorePort> {
    if (await this.postgres.isAvailable()) {
      return this.postgres
    }
    return this.memory
  }

  async create(input: CreatePhotoInput): Promise<PropertyPhoto> {
    const adapter = await this.adapter()
    return adapter.create(input)
  }

  async getById(id: string): Promise<PropertyPhoto | null> {
    const adapter = await this.adapter()
    return adapter.getById(id)
  }

  async list(filters?: PhotoFilters): Promise<PropertyPhoto[]> {
    const adapter = await this.adapter()
    return adapter.list(filters)
  }

  async update(id: string, input: UpdatePhotoInput): Promise<PropertyPhoto | null> {
    const adapter = await this.adapter()
    return adapter.update(id, input)
  }

  async delete(id: string): Promise<boolean> {
    const adapter = await this.adapter()
    return adapter.delete(id)
  }

  async reorder(input: ReorderPhotosInput): Promise<PropertyPhoto[]> {
    const adapter = await this.adapter()
    return adapter.reorder(input)
  }

  async setFeatured(photoId: string, propertyId: string): Promise<PropertyPhoto> {
    const adapter = await this.adapter()
    return adapter.setFeatured(photoId, propertyId)
  }

  async clear(): Promise<void> {
    const adapter = await this.adapter()
    return adapter.clear()
  }
}

export const propertyPhotoStore = new HybridPropertyPhotoStore()
