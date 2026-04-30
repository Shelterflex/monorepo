-- Property Photos Management
-- Supports ordering, featured status, and metadata for individual property photos
CREATE TABLE IF NOT EXISTS property_photos (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    property_id UUID NOT NULL REFERENCES landlord_properties(id) ON DELETE CASCADE,
    url TEXT NOT NULL,
    order_index INTEGER NOT NULL DEFAULT 0,
    is_featured BOOLEAN NOT NULL DEFAULT FALSE,
    file_name TEXT,
    file_size BIGINT,
    width INTEGER,
    height INTEGER,
    mime_type TEXT,
    uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT property_photos_url_not_empty CHECK (length(trim(url)) > 0),
    CONSTRAINT property_photos_order_index_non_negative CHECK (order_index >= 0)
);

CREATE INDEX IF NOT EXISTS property_photos_property_id_idx ON property_photos (property_id);
CREATE INDEX IF NOT EXISTS property_photos_order_idx ON property_photos (property_id, order_index);
CREATE INDEX IF NOT EXISTS property_photos_featured_idx ON property_photos (property_id, is_featured);

-- Ensure only one featured photo per property
CREATE UNIQUE INDEX IF NOT EXISTS property_photos_unique_featured_idx 
    ON property_photos (property_id) 
    WHERE is_featured = TRUE;

-- Trigger to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_property_photos_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS property_photos_updated_at_trigger ON property_photos;
CREATE TRIGGER property_photos_updated_at_trigger
    BEFORE UPDATE ON property_photos
    FOR EACH ROW
    EXECUTE FUNCTION update_property_photos_updated_at();
