import os
import sys
from pathlib import Path


os.environ.setdefault("SUPABASE_URL", "https://example.supabase.co")
os.environ.setdefault("SUPABASE_PUBLISHABLE_KEY", "test-publishable-key")
os.environ.setdefault("SUPABASE_SECRET_KEY", "test-secret-key")
os.environ.setdefault("INTERNAL_API_KEY", "test-internal-key")
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
