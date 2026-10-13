from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    environment: str = "development"
    frontend_origin: str = "http://localhost:3000"

    supabase_url: str
    supabase_publishable_key: str
    supabase_secret_key: str = ""

    internal_api_key: str
    groundtruth_url: str = "http://localhost:8001"
    yieldwise_url: str = "http://localhost:8002"
    fieldscout_url: str = "http://localhost:8003"

    telegram_bot_token: str = ""
    telegram_bot_username: str = ""
    telegram_webhook_secret: str = ""
    news_feed_urls: str = ""
    news_refresh_minutes: int = 30
    max_upload_bytes: int = 10 * 1024 * 1024
    upstream_timeout_seconds: float = 180

    model_config = SettingsConfigDict(env_file=".env", extra="ignore", case_sensitive=False)

    @property
    def feeds(self) -> list[str]:
        return [url.strip() for url in self.news_feed_urls.split(",") if url.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
