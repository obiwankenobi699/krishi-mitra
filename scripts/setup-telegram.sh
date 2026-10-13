#!/usr/bin/env bash
# End-to-end Telegram bot setup for Agraya (@farmers123bot).
# Automates everything the Bot API allows: name, about, description,
# command menu, webhook. Profile PHOTOS still need BotFather UI
# (no API for that) — suggested files printed at the end.
#
# Usage: bash scripts/setup-telegram.sh [public-base-url]
#   e.g. bash scripts/setup-telegram.sh https://xxxx.trycloudflare.com
#   (omit the URL to auto-detect from .local/logs/cloudflared.log)
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

BOT_TOKEN=$(grep ^TELEGRAM_BOT_TOKEN= .env 2>/dev/null | cut -d= -f2- || true)
SECRET=$(grep ^TELEGRAM_WEBHOOK_SECRET= .env 2>/dev/null | cut -d= -f2- || true)
[ -n "$BOT_TOKEN" ] || { echo "❌ TELEGRAM_BOT_TOKEN empty in .env"; exit 1; }
[ -n "$SECRET" ] || { echo "❌ TELEGRAM_WEBHOOK_SECRET empty in .env"; exit 1; }

BASE_URL="${1:-$(grep -o -E 'https://[a-z0-9-]+\.trycloudflare\.com' .local/logs/cloudflared.log 2>/dev/null | head -1)}"
[ -n "$BASE_URL" ] || { echo "❌ No tunnel URL — pass it: bash scripts/setup-telegram.sh https://<url>"; exit 1; }

API="https://api.telegram.org/bot$BOT_TOKEN"
fail=0

echo "==> [1/6] verifying token"
ME=$(curl -s --max-time 15 "$API/getMe")
echo "$ME" | grep -q '"ok":true' || { echo "❌ getMe failed: $ME"; exit 1; }
echo "    bot: $(echo "$ME" | grep -o '"username":"[^"]*"' | head -1)"

echo "==> [2/6] display name"
curl -s --max-time 15 "$API/setMyName" --data-urlencode "name=Krishi Mitra" | grep -q '"ok":true' \
  && echo "    ok" || { echo "❌ setMyName failed"; fail=1; }

echo "==> [3/6] about (short description)"
curl -s --max-time 15 "$API/setMyShortDescription" \
  --data-urlencode "short_description=Agraya farm assistant — snap a leaf, get diagnosis; sell harvest on the marketplace." \
  | grep -q '"ok":true' && echo "    ok" || { echo "❌ setMyShortDescription failed"; fail=1; }

echo "==> [4/6] description"
curl -s --max-time 15 "$API/setMyDescription" \
  --data-urlencode "description=Namaste! I check crop disease from photos and help you sell produce on the Agraya marketplace. Private by design — your photos are analysed and deleted, never stored. Use /diagnos for a crop check, /market to sell." \
  | grep -q '"ok":true' && echo "    ok" || { echo "❌ setMyDescription failed"; fail=1; }

echo "==> [5/6] command menu"
curl -s --max-time 15 "$API/setMyCommands" \
  --data-urlencode 'commands=[{"command":"diagnos","description":"check crop disease from a photo"},{"command":"market","description":"sell your produce step by step"},{"command":"cancel","description":"stop the current flow"},{"command":"help","description":"what this bot can do"},{"command":"start","description":"link your Agraya account"}]' \
  | grep -q '"ok":true' && echo "    ok" || { echo "❌ setMyCommands failed"; fail=1; }

echo "==> [6/6] webhook -> $BASE_URL/telegram/webhook"
curl -s --max-time 20 "$API/setWebhook" \
  --data-urlencode "url=$BASE_URL/telegram/webhook" \
  --data-urlencode "secret_token=$SECRET" \
  --data-urlencode 'allowed_updates=["message"]' | grep -q '"ok":true' \
  && echo "    ok" || { echo "❌ setWebhook failed"; fail=1; }

echo ""
echo "==> verification"
curl -s --max-time 15 "$API/getMyCommands" | grep -o '"command":"[a-z]*"' | tr '\n' ' '; echo ""
curl -s --max-time 15 "$API/getWebhookInfo" | grep -o '"url":"[^"]*"\|"pending_update_count":[0-9]*'; echo ""
echo ""
if [ "$fail" = "0" ]; then
  echo "✅ Bot setup complete."
else
  echo "⚠️  Some steps failed above — re-run this script."
fi
echo "Manual leftovers (BotFather has no API for these):"
echo "  - profile photo      -> upload public/images/hero-field.jpg"
echo "  - description picture -> upload public/images/farmer.jpg"
echo "Then message @farmers123bot: /help"
