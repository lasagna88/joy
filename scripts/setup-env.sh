#!/bin/bash
# Generate a .env.local file with secure random values for production deployment.
# Usage: bash scripts/setup-env.sh

set -e

if [ -f .env.local ]; then
  echo ".env.local already exists. Remove it first if you want to regenerate."
  exit 1
fi

JWT_SECRET=$(openssl rand -hex 32)
PASSPHRASE="change-me-$(openssl rand -hex 8)"

cat > .env.local << EOF
# Database (overridden by docker-compose, but needed for local dev)
DATABASE_URL=postgres://papwa:papwa_secret@localhost:5432/papwa

# Redis (overridden by docker-compose, but needed for local dev)
REDIS_URL=redis://localhost:6379

# Auth
PASSPHRASE=${PASSPHRASE}
JWT_SECRET=${JWT_SECRET}

# Claude API
ANTHROPIC_API_KEY=sk-ant-xxxxx

# Web Push (generate with: npx web-push generate-vapid-keys)
VAPID_PUBLIC_KEY=
VAPID_PRIVATE_KEY=
VAPID_SUBJECT=mailto:you@example.com

# Google Calendar (optional)
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REDIRECT_URI=https://your-domain.com/api/integrations/google/callback

# Bigin / Zoho CRM (optional)
ZOHO_CLIENT_ID=
ZOHO_CLIENT_SECRET=
ZOHO_REDIRECT_URI=https://your-domain.com/api/integrations/bigin/callback

# Whisper API (optional - for voice input)
OPENAI_API_KEY=

# App URL
NEXT_PUBLIC_APP_URL=http://localhost:3000
EOF

echo "Created .env.local with secure random values."
echo ""
echo "Next steps:"
echo "  1. Set your ANTHROPIC_API_KEY"
echo "  2. Set your PASSPHRASE to something memorable"
echo "  3. Generate VAPID keys: npx web-push generate-vapid-keys"
echo "  4. Update NEXT_PUBLIC_APP_URL to your domain"
echo "  5. Run: docker compose up -d"
