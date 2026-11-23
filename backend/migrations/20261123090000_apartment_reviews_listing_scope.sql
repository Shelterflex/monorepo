-- Apartment reviews are now scoped to Stellar Wave listings (#2050).
-- The original table (020) pointed apartment_id at landlord_properties, which
-- listings do not use, so the foreign key is dropped and the column renamed.

ALTER TABLE apartment_reviews DROP CONSTRAINT IF EXISTS apartment_reviews_apartment_id_fkey;
ALTER TABLE apartment_reviews RENAME COLUMN apartment_id TO listing_id;

-- One review per user per listing.
CREATE UNIQUE INDEX IF NOT EXISTS apartment_reviews_one_per_user_listing_uidx
    ON apartment_reviews (user_id, listing_id);

-- Distinct reports per review. The primary key stops one user from counting twice.
ALTER TABLE apartment_reviews ADD COLUMN IF NOT EXISTS report_count INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS apartment_review_reports (
    review_id UUID NOT NULL REFERENCES apartment_reviews(id) ON DELETE CASCADE,
    reporter_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (review_id, reporter_id)
);
