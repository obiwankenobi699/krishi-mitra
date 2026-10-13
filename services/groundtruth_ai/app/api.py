import asyncio
import json
import logging
import os
import tempfile
import threading

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from starlette.background import BackgroundTask
from pydantic import BaseModel, Field, field_validator
from fastapi.responses import FileResponse
from gtts import gTTS
from pydub import AudioSegment
from vosk import KaldiRecognizer, Model

from shared.core.config import settings
from shared.core.security import require_internal_api_key
from shared.core.uploads import read_limited_upload

from .services.rag_service import RAGNotReadyError, RAGUnavailableError, rag_service

logger = logging.getLogger(__name__)

# --- OFFLINE SPEECH-TO-TEXT SETUP ---
# /opt/vosk-model in Docker; overridden to .local/vosk-model for native dev
VOSK_MODEL_PATH = settings.VOSK_MODEL_PATH
_model: Model | None = None
_model_lock = threading.Lock()


def get_vosk_model() -> Model:
    global _model
    if _model is None:
        with _model_lock:
            if _model is None:
                _model = Model(VOSK_MODEL_PATH)
    return _model

def transcribe_audio_offline(audio_path: str) -> str:
    """
    Transcribes audio to text using the offline Vosk model.
    """
    try:
        # Vosk requires a specific audio format (16-bit PCM, 16000 Hz, mono)
        # We use pydub to convert the uploaded audio to this format
        audio = AudioSegment.from_file(audio_path)
        audio = audio.set_frame_rate(16000).set_sample_width(2).set_channels(1)

        recognizer = KaldiRecognizer(get_vosk_model(), 16000)
        recognizer.AcceptWaveform(audio.raw_data)
        result = json.loads(recognizer.FinalResult())
        
        transcribed_text = result.get('text', '')
        print(f"🎤 Offline Transcription: '{transcribed_text}'")
        return transcribed_text
    except Exception:
        logger.exception("Audio transcription failed")
        raise

router = APIRouter(dependencies=[Depends(require_internal_api_key)])

class QueryRequest(BaseModel):
    query: str = Field(min_length=2, max_length=2000)

    @field_validator("query")
    @classmethod
    def normalize_query(cls, value: str) -> str:
        value = " ".join(value.split())
        if not value:
            raise ValueError("query must not be blank")
        return value

class QueryResponse(BaseModel):
    answer: str

@router.post("/generate-truth", response_model=QueryResponse, tags=["RAG Query"])
async def handle_query(request: QueryRequest):
    """
    Endpoint to handle an incoming query. Replaces the /sms endpoint.
    """
    print(f"❓ Received query: '{request.query}'")
    try:
        ai_response = await rag_service.get_response(request.query)
        return QueryResponse(answer=ai_response)
    except RAGNotReadyError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except RAGUnavailableError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc

@router.post("/voice-query")
async def handle_voice_query(audio_file: UploadFile = File(...)):
    """
    Handles a voice query using a fully offline pipeline.
    """
    audio_bytes = await read_limited_upload(
        audio_file,
        max_bytes=15 * 1024 * 1024,
        allowed_content_types={
            "audio/mpeg",
            "audio/mp3",
            "audio/wav",
            "audio/x-wav",
            "audio/ogg",
            "audio/webm",
            "audio/mp4",
        },
    )
    suffix = {
        "audio/mpeg": ".mp3",
        "audio/mp3": ".mp3",
        "audio/wav": ".wav",
        "audio/x-wav": ".wav",
        "audio/ogg": ".ogg",
        "audio/webm": ".webm",
        "audio/mp4": ".m4a",
    }.get(audio_file.content_type, ".audio")
    input_path = ""
    output_path = ""
    try:
        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as input_file:
            input_file.write(audio_bytes)
            input_path = input_file.name
        query_text = await asyncio.to_thread(transcribe_audio_offline, input_path)
        if not query_text:
            raise HTTPException(status_code=422, detail="Could not understand the audio")

        text_answer = await rag_service.get_response(query_text)
        with tempfile.NamedTemporaryFile(delete=False, suffix=".mp3") as output_file:
            output_path = output_file.name
        await asyncio.to_thread(gTTS(text_answer, lang="en").save, output_path)
        return FileResponse(
            path=output_path,
            media_type="audio/mpeg",
            filename="response.mp3",
            background=BackgroundTask(os.unlink, output_path),
        )
    except HTTPException:
        raise
    except RAGNotReadyError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except RAGUnavailableError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception("Voice query failed")
        if output_path and os.path.exists(output_path):
            os.unlink(output_path)
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Voice processing is temporarily unavailable",
        ) from exc
    finally:
        if input_path and os.path.exists(input_path):
            os.unlink(input_path)
