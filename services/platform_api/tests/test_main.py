from app.main import app


def test_openapi_contains_platform_routes():
    paths = app.openapi()["paths"]

    assert "/farms/{farm_id}" in paths
    assert "/marketplace/{listing_id}" in paths
    assert "/ai/diagnose" in paths
    assert "/news" in paths
    assert "/telegram/link" in paths


def test_webhook_and_internal_refresh_are_hidden_from_openapi():
    paths = app.openapi()["paths"]

    assert "/telegram/webhook" not in paths
    assert "/news/refresh" not in paths
