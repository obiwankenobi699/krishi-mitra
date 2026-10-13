#!/usr/bin/env python3
"""Telegram long-polling worker (no tunnel, no public URL needed).

Polls Bot API getUpdates and forwards each update to the local gateway
webhook route, which holds ALL bot logic (modes, diagnosis, market flow).
Survives restarts: offset persisted to .local/tg-offset.

Usage:
  python3 scripts/tg-poll.py [--base-url URL] [--poll-seconds N]

Stdlib only. Reads BOT_TOKEN + WEBHOOK_SECRET from root .env.
First run calls deleteWebhook (polling and webhooks are mutually exclusive).
"""
import json
import os
import sys
import time
import urllib.parse
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def load_env(path):
    values = {}
    try:
        with open(path, encoding="utf-8") as handle:
            for line in handle:
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                key, _, val = line.partition("=")
                values[key.strip()] = val.strip().strip('"').strip("'")
    except OSError:
        pass
    return values


def api(bot_token, method, payload=None, timeout=60):
    data = json.dumps(payload or {}).encode() if payload is not None else None
    request = urllib.request.Request(
        f"https://api.telegram.org/bot{bot_token}/{method}",
        data=data,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return json.loads(response.read().decode())


def main() -> int:
    base_url = "http://localhost:8000"
    poll_seconds = 50
    args = sys.argv[1:]
    i = 0
    while i < len(args):
        if args[i] == "--base-url" and i + 1 < len(args):
            base_url = args[i + 1].rstrip("/")
            i += 2
        elif args[i] == "--poll-seconds" and i + 1 < len(args):
            poll_seconds = max(10, min(90, int(args[i + 1])))
            i += 2
        else:
            print(f"usage: tg-poll.py [--base-url URL] [--poll-seconds N]", flush=True)
            return 2

    env = load_env(os.path.join(ROOT, ".env"))
    bot_token = env.get("TELEGRAM_BOT_TOKEN", "")
    secret = env.get("TELEGRAM_WEBHOOK_SECRET", "")
    if not bot_token:
        print("TELEGRAM_BOT_TOKEN missing in .env", flush=True)
        return 1
    me = api(bot_token, "getMe", timeout=15)
    print(f"polling as @{(me.get('result') or {}).get('username', '?')}", flush=True)

    try:
        api(bot_token, "deleteWebhook", {"drop_pending_updates": False}, timeout=15)
        print("webhook mode off (polling owns delivery now)", flush=True)
    except Exception as exc:  # noqa: BLE001 — report and continue; polling still works
        print(f"deleteWebhook note: {exc}", flush=True)

    offset_path = os.path.join(ROOT, ".local", "tg-offset")
    os.makedirs(os.path.dirname(offset_path), exist_ok=True)
    try:
        with open(offset_path, encoding="utf-8") as handle:
            offset = int(handle.read().strip() or 0)
    except (OSError, ValueError):
        offset = 0

    backoff = 1
    local_url = f"{base_url}/telegram/webhook"
    while True:
        try:
            batch = api(
                bot_token,
                "getUpdates",
                {"offset": offset, "timeout": poll_seconds, "allowed_updates": ["message"]},
                timeout=poll_seconds + 15,
            )
            backoff = 1
        except Exception as exc:  # noqa: BLE001 — network blips must not kill the loop
            print(f"getUpdates failed ({exc}); retry in {backoff}s", flush=True)
            time.sleep(backoff)
            backoff = min(backoff * 2, 60)
            continue
        for update in batch.get("result", []):
            update_id = update.get("update_id", 0)
            try:
                body = json.dumps(update).encode()
                req = urllib.request.Request(
                    local_url,
                    data=body,
                    headers={
                        "Content-Type": "application/json",
                        "X-Telegram-Bot-Api-Secret-Token": secret,
                    },
                    method="POST",
                )
                with urllib.request.urlopen(req, timeout=30):
                    pass
            except Exception as exc:  # noqa: BLE001 — gateway down? keep offset, retry
                print(f"forward failed for update {update_id} ({exc}); will retry", flush=True)
                time.sleep(2)
                break
            offset = update_id + 1
            try:
                with open(offset_path, "w", encoding="utf-8") as handle:
                    handle.write(str(offset))
            except OSError:
                pass


if __name__ == "__main__":
    raise SystemExit(main())
