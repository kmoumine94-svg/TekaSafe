CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY,
  phone VARCHAR(25) UNIQUE NOT NULL,
  name VARCHAR(120) NOT NULL,
  roles TEXT[] NOT NULL DEFAULT ARRAY['buyer']::TEXT[],
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS products (
  id BIGSERIAL PRIMARY KEY,
  name VARCHAR(80) NOT NULL,
  price_cdf BIGINT NOT NULL CHECK (price_cdf > 0),
  price_usd INTEGER NOT NULL DEFAULT 0,
  area VARCHAR(40) NOT NULL,
  delivery VARCHAR(80) NOT NULL,
  seller VARCHAR(120) NOT NULL,
  rating VARCHAR(10) NOT NULL DEFAULT '0,0',
  sales INTEGER NOT NULL DEFAULT 0 CHECK (sales >= 0),
  emoji VARCHAR(16) NOT NULL DEFAULT '🛍️',
  tone VARCHAR(20) NOT NULL DEFAULT 'peach',
  tag VARCHAR(80) NOT NULL DEFAULT 'Nouvelle annonce',
  category VARCHAR(40) NOT NULL,
  stock INTEGER NOT NULL DEFAULT 0 CHECK (stock >= 0),
  vehicle BOOLEAN NOT NULL DEFAULT FALSE,
  year VARCHAR(10),
  km VARCHAR(20),
  fuel VARCHAR(30),
  gearbox VARCHAR(30),
  description VARCHAR(700) NOT NULL DEFAULT '',
  owner_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS products_category_idx ON products(category);
CREATE INDEX IF NOT EXISTS products_area_idx ON products(area);
CREATE INDEX IF NOT EXISTS products_created_at_idx ON products(created_at DESC);

CREATE TABLE IF NOT EXISTS otp_codes (
  phone VARCHAR(25) PRIMARY KEY,
  code_hash CHAR(64) NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS otp_codes_expires_at_idx ON otp_codes(expires_at);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash CHAR(64) PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS sessions_user_id_idx ON sessions(user_id);
CREATE INDEX IF NOT EXISTS sessions_expires_at_idx ON sessions(expires_at);

CREATE TABLE IF NOT EXISTS orders (
  order_number VARCHAR(30) PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id),
  items JSONB NOT NULL,
  total_cdf BIGINT NOT NULL CHECK (total_cdf >= 0),
  payment VARCHAR(40) NOT NULL,
  status VARCHAR(40) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS orders_user_created_idx ON orders(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS messages (
  id UUID PRIMARY KEY,
  sender VARCHAR(120) NOT NULL,
  recipient VARCHAR(120) NOT NULL,
  body VARCHAR(1000) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS messages_recipient_created_idx ON messages(recipient, created_at DESC);
