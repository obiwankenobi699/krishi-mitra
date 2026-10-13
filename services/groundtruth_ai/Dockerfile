FROM ghcr.io/astral-sh/uv:0.9.15 AS uv
FROM python:3.11.14-slim

# Install Tesseract OCR Engine and its dependencies
RUN apt-get update && apt-get install -y \
    tesseract-ocr \
    libtesseract-dev \
    libleptonica-dev \
    poppler-utils \
    ffmpeg \
    libasound2-dev \
    && rm -rf /var/lib/apt/lists/*

# Download and unzip the offline Vosk speech recognition model
RUN apt-get update && apt-get install -y wget unzip && \
    # Step 1: Download the file to a specific path
    wget -O /tmp/vosk.zip "https://alphacephei.com/vosk/models/vosk-model-small-en-us-0.15.zip" && \
    # Step 2: Unzip the file from that path
    unzip /tmp/vosk.zip -d /opt && \
    mv /opt/vosk-model-small-en-us-0.15 /opt/vosk-model && \
    rm /tmp/vosk.zip && \
    apt-get purge -y wget unzip && apt-get autoremove -y

WORKDIR /app

COPY --from=uv /uv /uvx /bin/
COPY ./services/groundtruth_ai/requirements.lock /app/requirements.lock
RUN uv pip install --system --no-cache -r /app/requirements.lock

COPY ./services/shared /app/shared
COPY ./services/utils /app/utils
COPY ./services/groundtruth_ai/app /app/app

COPY ./services/groundtruth_ai/download_docs.py /app/download_docs.py
COPY ./services/groundtruth_ai/entrypoint.sh /app/entrypoint.sh
COPY ./services/groundtruth_ai/govt.pem /app/govt.pem

RUN chmod +x /app/entrypoint.sh

EXPOSE 8000
ENTRYPOINT ["/app/entrypoint.sh"]
