# utils/model_loader.py
import logging
import os

import torch
from sentence_transformers import SentenceTransformer

class ModelUnavailableError(Exception):
    pass

def require_gpu() -> None:
    """Fail fast unless a CUDA GPU is visible. GPU-only policy, no CPU fallback."""
    if os.environ.get("REQUIRE_GPU", "1") == "0":
        return
    if not torch.cuda.is_available():
        raise ModelUnavailableError(
            "GPU required but CUDA is unavailable. "
            "Ensure the container was started with GPU access "
            "(Compose `deploy.resources.reservations.devices`) "
            "and the NVIDIA Container Toolkit is installed."
        )


def load_embedding_model(model_name: str, cache_path: str):
    require_gpu()
    try:
        model = SentenceTransformer(model_name, cache_folder=cache_path, device="cuda")
        logging.info(f"✅ Loaded embedding model '{model_name}' on CUDA "
                      f"(cache exists: {os.path.exists(cache_path)})")
        return model
    except OSError as e:
        logging.error(f"❌ Could not load model '{model_name}'. "
                      f"Cache missing and network unavailable. Error: {e}")
        raise ModelUnavailableError(
            f"No available model '{model_name}'. "
            f"Check network or cache at {cache_path}."
        )
