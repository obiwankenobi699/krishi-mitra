import logging
import secrets
from datetime import datetime, timedelta, timezone
from io import BytesIO
from uuid import uuid4

import httpx
from fastapi import (
    APIRouter,
    BackgroundTasks,
    Depends,
    Header,
    HTTPException,
    Request,
    Response,
    status,
)
from PIL import Image

from ..config import settings
from ..dependencies import current_user
from ..schemas import CurrentUser
from ..services.ai import analyze_image, database_severity, extract_analysis
from ..services.uploads import ALLOWED_IMAGE_TYPES, validate_image
from ..supabase import SupabaseGateway, get_gateway


router = APIRouter(prefix="/telegram", tags=["Telegram"])
logger = logging.getLogger(__name__)

HELP_TEXT = (
    "Namaste! I am the Agraya farm assistant.\n\n"
    "/diagnos — crop disease check: send a leaf photo after this\n"
    "/market — sell produce: send a photo, I will ask a few details\n"
    "/link <code> — link your Agraya account manually (from website > Farms > Telegram)\n"
    "/cancel — stop the current flow\n"
    "/help — show this message\n\n"
    "Link your Agraya account from the website first (Farms > Telegram)."
)

MARKET_UNITS = ("kg", "quintal", "tonne", "piece", "crate")

# Transient photo holding pen keyed by chat id (bytes never touch the DB;
# mode/step/draft below live in Supabase so conversations survive restarts).
# A restart mid-flow only asks the farmer to resend the photo.
_PHOTOS: dict[int, tuple[bytes, str]] = {}


async def _load_state(gateway: SupabaseGateway, user_id: str) -> dict:
    rows = await gateway.table(
        "telegram_chat_state",
        params={"select": "mode,step,draft", "user_id": f"eq.{user_id}", "limit": "1"},
        service=True,
    )
    if rows:
        return {
            "mode": rows[0].get("mode") or "",
            "step": rows[0].get("step") or "",
            "draft": rows[0].get("draft") or {},
        }
    return {"mode": "", "step": "", "draft": {}}


async def _save_state(gateway: SupabaseGateway, user_id: str, state: dict) -> None:
    await gateway.table(
        "telegram_chat_state",
        method="POST",
        params={"on_conflict": "user_id"},
        payload={
            "user_id": user_id,
            "mode": state.get("mode", ""),
            "step": state.get("step", ""),
            "draft": state.get("draft", {}),
        },
        prefer="resolution=merge-duplicates,return=minimal",
        service=True,
    )


async def _clear_state(gateway: SupabaseGateway, user_id: str, chat_id: int) -> None:
    await gateway.table(
        "telegram_chat_state",
        method="DELETE",
        params={"user_id": f"eq.{user_id}"},
        service=True,
    )
    _PHOTOS.pop(chat_id, None)


async def send_chat_action(client: httpx.AsyncClient, chat_id: int, action: str) -> None:
    try:
        await _telegram_request(
            client, "sendChatAction", json={"chat_id": chat_id, "action": action}
        )
    except HTTPException:
        pass


async def _linked_account(gateway: SupabaseGateway, chat_id: int) -> list:
    return await gateway.table(
        "telegram_accounts",
        params={"select": "user_id", "chat_id": f"eq.{chat_id}", "limit": "1"},
        service=True,
    )


async def _telegram_request(client: httpx.AsyncClient, method: str, **kwargs) -> dict:
    if not settings.telegram_bot_token:
        raise HTTPException(status_code=503, detail="Telegram bot is not configured")
    try:
        response = await client.post(
            f"https://api.telegram.org/bot{settings.telegram_bot_token}/{method}",
            timeout=20,
            **kwargs,
        )
        response.raise_for_status()
        data = response.json()
    except (httpx.HTTPError, ValueError) as exc:
        raise HTTPException(status_code=502, detail="Telegram API is unavailable") from exc
    if not data.get("ok"):
        raise HTTPException(status_code=502, detail="Telegram rejected the request")
    return data


@router.get("/account")
async def linked_account(
    user: CurrentUser = Depends(current_user), gateway: SupabaseGateway = Depends(get_gateway)
):
    rows = await gateway.table(
        "telegram_accounts",
        token=user.access_token,
        params={"select": "chat_id,username,linked_at", "user_id": f"eq.{user.id}", "limit": "1"},
    )
    return rows[0] if rows else None


@router.delete("/account", status_code=status.HTTP_204_NO_CONTENT)
async def unlink_account(
    user: CurrentUser = Depends(current_user), gateway: SupabaseGateway = Depends(get_gateway)
):
    await gateway.table(
        "telegram_accounts",
        method="DELETE",
        token=user.access_token,
        params={"user_id": f"eq.{user.id}"},
    )
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/link")
async def create_link_token(
    request: Request,
    user: CurrentUser = Depends(current_user),
    gateway: SupabaseGateway = Depends(get_gateway),
):
    if not settings.telegram_bot_token:
        raise HTTPException(status_code=503, detail="Telegram bot is not configured")
    bot_username = settings.telegram_bot_username.lstrip("@")
    if not bot_username:
        bot = await _telegram_request(request.app.state.http, "getMe")
        bot_username = bot.get("result", {}).get("username", "")
    if not bot_username:
        raise HTTPException(status_code=502, detail="Telegram bot username is unavailable")
    await gateway.table(
        "telegram_link_tokens",
        method="DELETE",
        token=user.access_token,
        params={"user_id": f"eq.{user.id}"},
    )
    token = secrets.token_urlsafe(24)
    expires_at = datetime.now(timezone.utc) + timedelta(minutes=15)
    await gateway.table(
        "telegram_link_tokens",
        method="POST",
        token=user.access_token,
        payload={"token": token, "user_id": str(user.id), "expires_at": expires_at.isoformat()},
    )
    return {"url": f"https://t.me/{bot_username}?start={token}", "code": token, "expires_at": expires_at}


@router.post("/webhook", include_in_schema=False)
async def telegram_webhook(
    request: Request,
    background_tasks: BackgroundTasks,
    x_telegram_bot_api_secret_token: str | None = Header(default=None),
):
    if not settings.telegram_webhook_secret or not secrets.compare_digest(
        x_telegram_bot_api_secret_token or "", settings.telegram_webhook_secret
    ):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Invalid webhook secret")
    try:
        update = await request.json()
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="Invalid webhook payload") from exc
    if not isinstance(update, dict) or not isinstance(update.get("update_id"), int):
        raise HTTPException(status_code=400, detail="Invalid Telegram update")
    background_tasks.add_task(process_update_safely, request.app, update)
    return {"ok": True}


async def send_message(client: httpx.AsyncClient, chat_id: int, text: str) -> None:
    await _telegram_request(client, "sendMessage", json={"chat_id": chat_id, "text": text[:4000]})


async def process_update_safely(app, update: dict) -> None:
    chat_id = ((update.get("message") or {}).get("chat") or {}).get("id")
    try:
        await process_update(app, update)
    except Exception:
        logger.exception("Telegram update %s failed", update.get("update_id"))
        if chat_id:
            try:
                await send_message(
                    app.state.http, chat_id, "Processing failed. Please try again later."
                )
            except HTTPException:
                pass


async def process_update(app, update: dict) -> None:
    gateway: SupabaseGateway = app.state.supabase
    client: httpx.AsyncClient = app.state.http
    update_id = update["update_id"]
    try:
        await gateway.table(
            "telegram_updates",
            method="POST",
            payload={"update_id": update_id},
            prefer="return=minimal",
            service=True,
        )
    except HTTPException as exc:
        if exc.status_code == 409:
            return
        raise

    message = update.get("message") or {}
    chat_id = (message.get("chat") or {}).get("id")
    if not chat_id:
        return
    text = (message.get("text") or "").strip()
    # Strip @botname suffix in groups: /link@farmers123bot <code>
    command, _, arg = text.partition(" ")
    command = command.split("@")[0]
    if command == "/start" and arg:
        await _link_chat(gateway, client, message, chat_id, arg.strip())
        return
    if command == "/link":
        if not arg.strip():
            await send_message(
                client,
                chat_id,
                "Paste your code after the command, like this:\n/link ABC123xyz\n\nGet the code: website > Farms > Telegram > Generate connection link.",
            )
            return
        await _link_chat(gateway, client, message, chat_id, arg.strip())
        return
    if command == "/start" or command == "/help":
        await send_message(client, chat_id, HELP_TEXT)
        return
    if command == "/cancel":
        accounts = await _linked_account(gateway, chat_id)
        if accounts:
            await _clear_state(gateway, accounts[0]["user_id"], chat_id)
        await send_message(client, chat_id, "Cancelled. Use /diagnos for crop check or /market to sell.")
        return
    if command == "/diagnos" or command == "/market":
        accounts = await _linked_account(gateway, chat_id)
        if not accounts:
            await send_message(
                client, chat_id, "Link your account first: website > Farms > Telegram, or send /link <code>."
            )
            return
        user_id = accounts[0]["user_id"]
        if command == "/diagnos":
            await _save_state(gateway, user_id, {"mode": "diagnose", "step": "", "draft": {}})
            await send_message(
                client, chat_id, "Diagnosis mode on. Send a clear leaf photo — I will analyse it now."
            )
        else:
            await _save_state(
                gateway, user_id, {"mode": "market", "step": "photo", "draft": {}}
            )
            await send_message(
                client, chat_id, "Market mode on. Send a photo of your produce to start the listing."
            )
        return

    accounts = await _linked_account(gateway, chat_id)
    if not accounts:
        await send_message(client, chat_id, "Link your account from the Agri Suite website first.")
        return
    user_id = accounts[0]["user_id"]
    state = await _load_state(gateway, user_id)
    mode = state.get("mode")
    photos = message.get("photo") or []
    if photos:
        content, content_type = await _download_telegram_photo(client, message, photos[-1])
        if mode == "market":
            await _market_photo(client, gateway, user_id, chat_id, content, content_type)
        else:
            caption = (message.get("caption") or "").lower()
            analysis_mode = (
                "field_health_analysis"
                if "/field" in caption
                else "crop_identification"
                if "/identify" in caption
                else "disease_diagnosis"
            )
            await _diagnose_photo(client, gateway, accounts[0], chat_id, content, content_type, analysis_mode, update_id)
        return
    if mode == "market":
        await _market_text(client, gateway, user_id, accounts[0], chat_id, text, state)
        return
    if text:
        await send_message(
            client,
            chat_id,
            "Send a crop photo to analyse, or use /diagnos for check mode and /market to sell.",
        )


async def _download_telegram_photo(
    client: httpx.AsyncClient, message: dict, photo: dict
) -> tuple[bytes, str]:
    await send_chat_action(client, (message.get("chat") or {}).get("id"), "upload_photo")
    file_data = await _telegram_request(client, "getFile", params={"file_id": photo["file_id"]})
    file_path = file_data.get("result", {}).get("file_path")
    if not file_path:
        raise HTTPException(status_code=502, detail="Telegram image path is unavailable")
    image_response = await client.get(
        f"https://api.telegram.org/file/bot{settings.telegram_bot_token}/{file_path}", timeout=30
    )
    image_response.raise_for_status()
    content = image_response.content
    if len(content) > settings.max_upload_bytes:
        raise HTTPException(status_code=413, detail="Image is too large for processing")
    content_type = image_response.headers.get("content-type", "image/jpeg").split(";", 1)[0]
    if content_type not in ALLOWED_IMAGE_TYPES:
        # Telegram's file server often answers application/octet-stream.
        # Sniff the real type from magic bytes instead of rejecting it.
        content_type = _sniff_image_type(content) or content_type
    validate_image(content, content_type)
    return content, content_type


def _sniff_image_type(content: bytes) -> str | None:
    try:
        with Image.open(BytesIO(content)) as image:
            image.load()
            return {"JPEG": "image/jpeg", "PNG": "image/png", "WEBP": "image/webp"}.get(
                image.format or ""
            )
    except Exception:
        return None


def _format_diagnosis(analysis: dict) -> str:
    condition = analysis.get("condition") or "Unknown"
    confidence = analysis.get("confidence")
    try:
        pct = f"{round(float(confidence) * 100)}%" if confidence is not None else "?"
    except (TypeError, ValueError):
        pct = "?"
    lines = [f"🔍 {condition} ({pct} confidence)"]
    observations = [o for o in (analysis.get("observations") or []) if isinstance(o, str)][:2]
    lines.extend(f"• {o}" for o in observations)
    actions = [a for a in (analysis.get("recommended_actions") or []) if isinstance(a, str)][:3]
    if actions:
        lines.append("Do this:")
        lines.extend(f"• {a}" for a in actions)
    lines.append("Full report with marked photo: open Diagnoses in the app.")
    return "\n".join(lines)


async def _diagnose_photo(client, gateway, account, chat_id, content, content_type, analysis_mode, update_id):
    await send_message(client, chat_id, "Photo received — analysing (about 10 seconds)…")
    await send_chat_action(client, chat_id, "typing")
    try:
        result = await analyze_image(client, content, content_type, analysis_mode)
    except HTTPException:
        await send_message(
            client, chat_id, "Models are warming up — please send the photo again in a moment."
        )
        return
    analysis = extract_analysis(result)
    image_path = f"{account['user_id']}/telegram-{update_id}{_extension_for(content_type)}"
    await gateway.upload("diagnosis-images", image_path, content, content_type, service=True)
    await gateway.table(
        "diagnoses",
        method="POST",
        service=True,
        payload={
            "owner_id": account["user_id"],
            "analysis_mode": analysis_mode,
            "image_path": image_path,
            "crop": analysis.get("crop"),
            "condition": analysis.get("condition"),
            "confidence": analysis.get("confidence"),
            "severity": database_severity(analysis),
            "result": analysis,
            "source": "telegram",
        },
    )
    await send_message(client, chat_id, _format_diagnosis(analysis))


def _extension_for(content_type: str) -> str:
    return {"/jpeg": ".jpg", "/png": ".png", "/webp": ".webp"}.get(
        "/" + (content_type or "").split("/")[-1], ".jpg"
    )


async def _market_photo(
    client, gateway: SupabaseGateway, user_id: str, chat_id: int, content: bytes, content_type: str
) -> None:
    _PHOTOS[chat_id] = (content, content_type)
    await _save_state(gateway, user_id, {"mode": "market", "step": "crop", "draft": {}})
    await send_message(client, chat_id, "Nice produce! What crop is this? (e.g. tomato)")


async def _market_text(
    client, gateway: SupabaseGateway, user_id: str, account, chat_id: int, text: str, state: dict
) -> None:
    step = state.get("step", "photo")
    draft = state.get("draft", {})
    if step == "photo":
        await send_message(client, chat_id, "First send a photo of the produce.")
        return
    if step == "crop":
        if len(text) < 2:
            await send_message(client, chat_id, "Please tell the crop name (e.g. tomato).")
            return
        draft["crop"] = text[:80]
        state["step"] = "quantity"
        await _save_state(gateway, user_id, state)
        await send_message(client, chat_id, "How much? Reply like: 200 quintal")
        return
    if step == "quantity":
        qty, unit = _parse_quantity(text)
        if qty is None:
            await send_message(
                client, chat_id, f"Could not read that. Reply quantity + unit ({', '.join(MARKET_UNITS)})."
            )
            return
        draft["quantity"], draft["unit"] = qty, unit
        state["step"] = "price"
        await _save_state(gateway, user_id, state)
        await send_message(client, chat_id, f"Price per {unit} in ₹?")
        return
    if step == "price":
        try:
            price = float(text.replace(",", "").strip().split()[0])
            if price < 0:
                raise ValueError
        except ValueError:
            await send_message(client, chat_id, "Reply with a number, e.g. 1800.")
            return
        draft["price"] = price
        state["step"] = "state"
        await _save_state(gateway, user_id, state)
        await send_message(client, chat_id, "Which state is the produce in?")
        return
    if step == "state":
        if len(text) < 2:
            await send_message(client, chat_id, "Please tell the state.")
            return
        draft["state"] = text[:100]
        state["step"] = "district"
        await _save_state(gateway, user_id, state)
        await send_message(client, chat_id, "Which district?")
        return
    if step == "district":
        if len(text) < 2:
            await send_message(client, chat_id, "Please tell the district.")
            return
        draft["district"] = text[:100]
        state["step"] = "phone"
        await _save_state(gateway, user_id, state)
        await send_message(
            client, chat_id, "Buyer contact number? (or /skip — buyers then reach you via the app)"
        )
        return
    if step == "phone":
        if text != "/skip":
            digits = "".join(c for c in text if c.isdigit() or c == "+")
            if len(digits) < 7 or len(digits) > 20:
                await send_message(client, chat_id, "That number looks off. Retry or /skip.")
                return
            draft["contact_phone"] = digits
        state["step"] = "confirm"
        await _save_state(gateway, user_id, state)
        summary = (
            f"{draft['crop']} — {draft['quantity']} {draft['unit']} @ ₹{draft['price']}/{draft['unit']}\n"
            f"{draft['district']}, {draft['state']}"
        )
        await send_message(client, chat_id, f"Ready to publish:\n{summary}\nReply YES to publish or /cancel.")
        return
    if step == "confirm":
        if text.strip().lower() not in ("yes", "y", "haan", "haan ji"):
            await send_message(client, chat_id, "Reply YES to publish, or /cancel to stop.")
            return
        await _publish_market_listing(client, gateway, account, chat_id, state)
        return
    await send_message(client, chat_id, "Send a photo to begin, or /cancel.")


def _parse_quantity(text: str) -> tuple[float | None, str | None]:
    parts = text.strip().lower().split()
    if not parts:
        return None, None
    try:
        qty = float(parts[0].replace(",", ""))
    except ValueError:
        return None, None
    unit = parts[1].rstrip("s") if len(parts) > 1 else "quintal"
    if unit not in MARKET_UNITS:
        return None, None
    if qty <= 0:
        return None, None
    return qty, unit


async def _publish_market_listing(client, gateway, account, chat_id: int, state: dict) -> None:
    user_id = account["user_id"]
    draft = state.get("draft", {})
    held = _PHOTOS.get(chat_id)
    content, content_type = held if held else (None, None)
    if not content:
        await send_message(
            client, chat_id, "Photo went missing (server restarted?) — please send it again with /market."
        )
        await _save_state(gateway, user_id, {"mode": "market", "step": "photo", "draft": {}})
        return
    await send_message(client, chat_id, "Publishing your listing…")
    await send_chat_action(client, chat_id, "typing")
    extension = _extension_for(content_type)
    image_path = f"{account['user_id']}/telegram-market-{uuid4().hex[:8]}{extension}"
    await gateway.upload("marketplace-images", image_path, content, content_type, service=True)
    title = f"Fresh {draft['crop']} — {draft['district']}"
    await gateway.table(
        "listings",
        method="POST",
        service=True,
        payload={
            "owner_id": account["user_id"],
            "seller_name": draft.get("seller_name") or "Telegram farmer",
            "title": title[:140],
            "crop": draft["crop"][:80],
            "description": "Listed via Telegram bot.",
            "quantity": draft["quantity"],
            "unit": draft["unit"],
            "price": draft["price"],
            "state": draft["state"][:100],
            "district": draft["district"][:100],
            "contact_phone": draft.get("contact_phone"),
            "image_paths": [image_path],
            "status": "active",
        },
    )
    _PHOTOS.pop(chat_id, None)
    await _clear_state(gateway, user_id, chat_id)
    await send_message(
        client, chat_id, f"Published! Buyers can now see it in Marketplace: {title}."
    )


async def _link_chat(
    gateway: SupabaseGateway, client: httpx.AsyncClient, message: dict, chat_id: int, token: str
) -> None:
    links = await gateway.table(
        "telegram_link_tokens",
        params={"select": "*", "token": f"eq.{token}", "limit": "1"},
        service=True,
    )
    if not links:
        await send_message(
            client, chat_id, "This link is invalid or expired. Generate a new link in the app."
        )
        return
    expires_at = datetime.fromisoformat(links[0]["expires_at"].replace("Z", "+00:00"))
    if expires_at <= datetime.now(timezone.utc):
        await gateway.table(
            "telegram_link_tokens", method="DELETE", params={"token": f"eq.{token}"}, service=True
        )
        await send_message(client, chat_id, "This link expired. Generate a new link in the app.")
        return
    await gateway.table(
        "telegram_accounts",
        method="POST",
        params={"on_conflict": "user_id"},
        payload={
            "user_id": links[0]["user_id"],
            "chat_id": chat_id,
            "username": (message.get("from") or {}).get("username"),
        },
        prefer="resolution=merge-duplicates,return=minimal",
        service=True,
    )
    await gateway.table(
        "telegram_link_tokens", method="DELETE", params={"token": f"eq.{token}"}, service=True
    )
    await _clear_state(gateway, links[0]["user_id"], chat_id)
    await send_message(
        client, chat_id, "Account linked. Send a clear crop or field image for analysis."
    )
