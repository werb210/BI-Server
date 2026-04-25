CREATE TABLE admin_login_security (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT UNIQUE NOT NULL,
  failed_attempts INTEGER DEFAULT 0,
  locked_until TIMESTAMP,
  updated_at TIMESTAMP DEFAULT NOW()
);
