from app.news_ingest import parse_feed


def test_parse_rss_feed():
    content = b"""<?xml version="1.0"?>
    <rss><channel><item><title>Crop alert</title>
    <description><![CDATA[<b>Watch your fields</b>]]></description>
    <link>https://news.example/item</link>
    <pubDate>Fri, 10 Oct 2025 10:00:00 GMT</pubDate>
    </item></channel></rss>"""

    articles = parse_feed(content, "https://news.example/feed.xml")

    assert articles == [
        {
            "title": "Crop alert",
            "summary": "Watch your fields",
            "source_name": "news.example",
            "source_url": "https://news.example/item",
            "category": "general",
            "published_at": "2025-10-10T10:00:00+00:00",
        }
    ]


def test_parse_feed_rejects_oversized_input():
    try:
        parse_feed(b"x" * (2 * 1024 * 1024 + 1), "https://news.example/feed.xml")
    except ValueError as exc:
        assert "2 MB" in str(exc)
    else:
        raise AssertionError("oversized feed was accepted")
