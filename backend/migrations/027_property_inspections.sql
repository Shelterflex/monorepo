ALTER TABLE whistleblower_listings
  ADD COLUMN IF NOT EXISTS has_verified_inspection BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS trust_score INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS inspector_profiles (
  user_id TEXT PRIMARY KEY,
  verification_status TEXT NOT NULL DEFAULT 'pending',
  bio TEXT,
  service_areas TEXT[] NOT NULL DEFAULT '{}',
  completed_inspections INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS property_inspections (
  id TEXT PRIMARY KEY,
  listing_id TEXT NOT NULL REFERENCES whistleblower_listings(listing_id) ON DELETE CASCADE,
  inspector_id TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  scheduled_at TIMESTAMPTZ NOT NULL,
  submitted_at TIMESTAMPTZ,
  approved_at TIMESTAMPTZ,
  inspector_notes TEXT,
  rejection_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS inspection_checklist_items (
  id TEXT PRIMARY KEY,
  inspection_id TEXT NOT NULL REFERENCES property_inspections(id) ON DELETE CASCADE,
  category TEXT NOT NULL,
  item TEXT NOT NULL,
  result TEXT NOT NULL,
  notes TEXT
);

CREATE TABLE IF NOT EXISTS inspection_photos (
  id TEXT PRIMARY KEY,
  inspection_id TEXT NOT NULL REFERENCES property_inspections(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  caption TEXT,
  taken_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_property_inspections_listing_status
  ON property_inspections(listing_id, status, approved_at DESC);

CREATE INDEX IF NOT EXISTS idx_property_inspections_inspector_status
  ON property_inspections(inspector_id, status);
