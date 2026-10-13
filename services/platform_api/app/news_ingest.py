import asyncio
import html
import re
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from urllib.parse import urlparse

import httpx

from .config import settings
from .supabase import SupabaseGateway


def _text(element: ET.Element, *names: str) -> str:
    for name in names:
        child = element.find(name)
        if child is not None and child.text:
            return child.text.strip()
    return ""


def _clean(value: str) -> str:
    without_tags = re.sub(r"<[^>]+>", " ", html.unescape(value))
    return re.sub(r"\s+", " ", without_tags).strip()[:1200]


def _date(value: str) -> str:
    if not value:
        return datetime.now(timezone.utc).isoformat()
    try:
        return parsedate_to_datetime(value).astimezone(timezone.utc).isoformat()
    except (TypeError, ValueError):
        try:
            return datetime.fromisoformat(value.replace("Z", "+00:00")).isoformat()
        except ValueError:
            return datetime.now(timezone.utc).isoformat()


def parse_feed(content: bytes, feed_url: str) -> list[dict]:
    if len(content) > 2 * 1024 * 1024:
        raise ValueError("Feed exceeds the 2 MB limit")
    lowered = content.lower()
    if b"<!doctype" in lowered or b"<!entity" in lowered:
        raise ValueError("XML document declarations are not allowed")
    root = ET.fromstring(content)
    source = urlparse(feed_url).netloc.removeprefix("www.")
    records = []
    for item in root.findall(".//item"):
        link = _text(item, "link")
        title = _clean(_text(item, "title"))
        if title and link:
            records.append(
                {
                    "title": title,
                    "summary": _clean(_text(item, "description")),
                    "source_name": source,
                    "source_url": link,
                    "category": "general",
                    "published_at": _date(_text(item, "pubDate")),
                }
            )
    atom = {"atom": "http://www.w3.org/2005/Atom"}
    for entry in root.findall(".//atom:entry", atom):
        link_element = entry.find("atom:link", atom)
        link = link_element.get("href", "") if link_element is not None else ""
        title = _clean(_text(entry, "{http://www.w3.org/2005/Atom}title"))
        if title and link:
            records.append(
                {
                    "title": title,
                    "summary": _clean(
                        _text(
                            entry,
                            "{http://www.w3.org/2005/Atom}summary",
                            "{http://www.w3.org/2005/Atom}content",
                        )
                    ),
                    "source_name": source,
                    "source_url": link,
                    "category": "general",
                    "published_at": _date(
                        _text(
                            entry,
                            "{http://www.w3.org/2005/Atom}published",
                            "{http://www.w3.org/2005/Atom}updated",
                        )
                    ),
                }
            )
    return records[:50]


async def refresh_news(
    client: httpx.AsyncClient, gateway: SupabaseGateway, feed_urls: list[str] | None = None
) -> int:
    feeds = feed_urls if feed_urls is not None else settings.feeds
    if not feeds or not settings.supabase_secret_key:
        return 0
    ingested = 0
    for feed_url in feeds:
        parsed_url = urlparse(feed_url)
        if parsed_url.scheme not in {"http", "https"} or not parsed_url.netloc:
            continue
        try:
            response = await client.get(feed_url, timeout=20, follow_redirects=True)
            response.raise_for_status()
            articles = parse_feed(response.content, feed_url)
            if articles:
                await gateway.table(
                    "news_articles",
                    method="POST",
                    params={"on_conflict": "source_url"},
                    payload=articles,
                    prefer="resolution=merge-duplicates,return=minimal",
                    service=True,
                )
                ingested += len(articles)
        except (httpx.HTTPError, ET.ParseError, ValueError):
            continue
    return ingested


async def news_loop(client: httpx.AsyncClient, gateway: SupabaseGateway) -> None:
    while True:
        await refresh_news(client, gateway)
        await asyncio.sleep(max(settings.news_refresh_minutes, 5) * 60)
