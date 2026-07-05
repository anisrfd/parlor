"""Configuration — the only module that reads the environment."""

import os

from dotenv import load_dotenv

load_dotenv()

# Where the Node glue service (Gemma + edge-tts) lives.
NODE_SERVICE_URL = os.environ.get("NODE_SERVICE_URL", "http://localhost:8100").rstrip("/")

# Timeout (seconds) for calls to the Node service.
NODE_SERVICE_TIMEOUT = float(os.environ.get("NODE_SERVICE_TIMEOUT", "40"))

# Port this browser-facing server listens on.
PORT = int(os.environ.get("PORT", "8001"))
