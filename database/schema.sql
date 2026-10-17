
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS rr_accounts (
  id BIGSERIAL PRIMARY KEY,
  username TEXT NOT NULL,
  username_norm TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  imported_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS rr_inventory (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id BIGINT NOT NULL
    REFERENCES rr_accounts(id) ON DELETE CASCADE,
  relic_id TEXT NOT NULL,
  variant TEXT NOT NULL
    CHECK (variant IN ('normal', 'gold', 'candy', 'diamond')),
  serial TEXT,
  verification_status TEXT NOT NULL DEFAULT 'server_recorded'
    CHECK (verification_status IN (
      'imported_unverified', 'server_recorded'
    )),
  acquired_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS rr_inventory_owner_idx
  ON rr_inventory(owner_id);

CREATE TABLE IF NOT EXISTS rr_trades (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  from_account BIGINT NOT NULL
    REFERENCES rr_accounts(id) ON DELETE CASCADE,
  to_account BIGINT NOT NULL
    REFERENCES rr_accounts(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN (
      'pending', 'accepted', 'rejected', 'cancelled'
    )),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  CHECK (from_account <> to_account)
);

CREATE TABLE IF NOT EXISTS rr_trade_items (
  trade_id UUID NOT NULL
    REFERENCES rr_trades(id) ON DELETE CASCADE,
  inventory_id UUID NOT NULL
    REFERENCES rr_inventory(id) ON DELETE CASCADE,
  original_owner BIGINT NOT NULL
    REFERENCES rr_accounts(id) ON DELETE CASCADE,
  PRIMARY KEY (trade_id, inventory_id)
);

CREATE TABLE IF NOT EXISTS rr_trade_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code_hash TEXT NOT NULL UNIQUE,
  inventory_id UUID NOT NULL
    REFERENCES rr_inventory(id) ON DELETE CASCADE,
  owner_id BIGINT NOT NULL
    REFERENCES rr_accounts(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  redeemed_by BIGINT
    REFERENCES rr_accounts(id) ON DELETE SET NULL,
  redeemed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
