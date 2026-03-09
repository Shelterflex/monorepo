CREATE TABLE wallets (
    user_id TEXT PRIMARY KEY,
    public_key TEXT NOT NULL,
    encrypted_secret_key TEXT NOT NULL,
    key_id TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE linked_addresses (
    user_id TEXT PRIMARY KEY,
    address TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX linked_addresses_address_uidx
ON linked_addresses (address);
