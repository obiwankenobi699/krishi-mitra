from functools import lru_cache
from urllib.parse import quote_plus

from pydantic import model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """
    Loads all environment variables into a typed settings object.
    """
    # Project
    ENVIRONMENT: str = "development"
    SECRET_KEY: str
    INTERNAL_API_KEY: str
    CORS_ORIGINS: str = "http://localhost:3000"

    # Database
    POSTGRES_SERVER: str | None = None
    POSTGRES_PORT: int = 5432
    POSTGRES_USER: str | None = None
    POSTGRES_PASSWORD: str | None = None
    POSTGRES_DB: str | None = None
    DATABASE_URL: str | None = None
    SUPABASE_DB_URL: str | None = None

    @model_validator(mode="after")
    def resolve_database_url(self) -> "Settings":
        """Prefer Supabase, then an explicit URL, then local Postgres settings."""
        if self.SUPABASE_DB_URL:
            self.DATABASE_URL = self.SUPABASE_DB_URL
        elif not self.DATABASE_URL:
            required = (
                self.POSTGRES_SERVER,
                self.POSTGRES_USER,
                self.POSTGRES_PASSWORD,
                self.POSTGRES_DB,
            )
            if not all(required):
                raise ValueError(
                    "Set SUPABASE_DB_URL, DATABASE_URL, or all POSTGRES_* settings"
                )
            password = quote_plus(self.POSTGRES_PASSWORD or "")
            self.DATABASE_URL = (
                f"postgresql+asyncpg://{self.POSTGRES_USER}:{password}"
                f"@{self.POSTGRES_SERVER}:{self.POSTGRES_PORT}/{self.POSTGRES_DB}"
            )
        return self

    @property
    def SYNC_DATABASE_URL(self) -> str:
        """Return a SQLAlchemy sync URL for psycopg2 consumers."""
        assert self.DATABASE_URL is not None
        return self.DATABASE_URL.replace("postgresql+asyncpg://", "postgresql+psycopg2://", 1)

    @property
    def cors_origins(self) -> list[str]:
        return [origin.strip() for origin in self.CORS_ORIGINS.split(",") if origin.strip()]

    # Prototype 1: GroundTruth AI
    # TWILIO_ACCOUNT_SID: str
    # TWILIO_AUTH_TOKEN: str
    # TWILIO_PHONE_NUMBER: str

    # AI Models
    # OPENAI_API_KEY: str

    DATA_GOV_API_KEY: str = ""

    # Local AI Model Settings
    LOCAL_LLM_MODEL: str
    OLLAMA_API_BASE_URL: str
    EMBEDDING_MODEL_NAME: str
    VISION_MODEL: str

    # HuggingFace cache
    HF_HOME: str = "/root/.cache/huggingface"  # default if not set

    # Local service state (Docker defaults; override for native dev)
    CHROMA_DB_PATH: str = "/chroma_db"
    MODEL_DIR: str = "/models"
    KNOWLEDGE_DOCS_DIR: str = "./knowledge_documents"
    VOSK_MODEL_PATH: str = "/opt/vosk-model"

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding='utf-8', extra='ignore')


@lru_cache()
def get_settings() -> Settings:
    """
    Returns the settings object.
    The lru_cache decorator ensures this function is only run once.
    """
    return Settings()

# Instantiate once to be imported by other modules
settings = get_settings()
