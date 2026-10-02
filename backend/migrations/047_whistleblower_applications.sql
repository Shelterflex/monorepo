-- Whistleblower applications table for storing application data with admin review workflow
CREATE TABLE IF NOT EXISTS whistleblower_applications (
  application_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT NOT NULL,
  address TEXT NOT NULL,
  linkedin_profile TEXT NOT NULL,
  facebook_profile TEXT NOT NULL,
  instagram_profile TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reviewed_at TIMESTAMPTZ,
  reviewed_by TEXT,
  rejection_reason TEXT,
  social_score INTEGER DEFAULT 50,
  green_flags JSONB DEFAULT '[]'::jsonb,
  red_flags JSONB DEFAULT '[]'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_whistleblower_applications_email ON whistleblower_applications(LOWER(email));
CREATE INDEX IF NOT EXISTS idx_whistleblower_applications_status ON whistleblower_applications(status);
CREATE INDEX IF NOT EXISTS idx_whistleblower_applications_created_at ON whistleblower_applications(created_at DESC);
