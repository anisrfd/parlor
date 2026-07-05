"""Parlor — real-time Bengali voice + vision assistant (browser-facing server).

Adapted from the original on-device server. The heavy on-device models (Gemma via
LiteRT-LM, Kokoro TTS) were swapped for cloud services that live in the Node glue
service (../node-service):

    speech -> text : handled in the browser (Web Speech API, Bengali)
    text  -> reply : NodeClient.infer  -> Gemma via Google AI Studio
    reply -> voice : NodeClient.synthesize -> edge-tts Bengali neural voice

This module owns only what it always did well: the WebSocket lifecycle, sentence-level
streaming, and barge-in / interrupt handling. Reasoning + voice are delegated to the
injected NodeClient gateway; text shaping lives in text_utils.
"""

import asyncio
import base64
import json
import time
from contextlib import asynccontextmanager
from pathlib import Path

import uvicorn
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.responses import HTMLResponse, Response

import config
from node_client import NodeClient
from text_utils import camera_context, split_sentences

INFER_ERROR_MESSAGE = "দুঃখিত, এই মুহূর্তে উত্তর দিতে পারছি না। একটু পরে আবার চেষ্টা করুন।"

# The gateway to the Node service, created for the app's lifetime in lifespan.
node: NodeClient | None = None


@asynccontextmanager
async def lifespan(app):
    global node
    node = NodeClient(config.NODE_SERVICE_URL, timeout=config.NODE_SERVICE_TIMEOUT)
    print(f"Parlor server ready. Proxying model + voice to {config.NODE_SERVICE_URL}")
    yield
    await node.aclose()


app = FastAPI(lifespan=lifespan)


@app.get("/")
async def root():
    return HTMLResponse(content=(Path(__file__).parent / "index.html").read_text(encoding="utf-8"))


# Browsers auto-probe these; we serve no icon and no devtools config, so answer
# 204 to keep the logs clean instead of emitting 404s.
@app.get("/favicon.ico")
@app.get("/.well-known/appspecific/com.chrome.devtools.json")
async def _no_content():
    return Response(status_code=204)


async def _reply_text(text: str, image, context) -> tuple[str, float]:
    """Get the assistant reply and how long it took (seconds)."""
    t0 = time.time()
    try:
        response = (await node.infer(text, image, context)).strip()
    except Exception as e:  # noqa: BLE001
        print(f"infer error: {e}")
        response = INFER_ERROR_MESSAGE
    return response, time.time() - t0


async def _stream_tts(ws: WebSocket, text: str, interrupted: asyncio.Event) -> None:
    """Split the reply into sentences and stream MP3 chunks as they're synthesized.

    All sentences are synthesized CONCURRENTLY (each /tts call opens its own edge-tts
    session, so they parallelize well) while chunks are still sent strictly in order.
    Total synthesis latency ≈ the slowest sentence instead of the sum — measured ~2x
    faster for a 3-sentence reply, and it removes mid-speech gaps between sentences.
    """
    sentences = split_sentences(text) or [text]
    tts_start = time.time()

    await ws.send_text(json.dumps({
        "type": "audio_start",
        "mime": "audio/mpeg",
        "sentence_count": len(sentences),
    }))

    tasks = [asyncio.create_task(node.synthesize(s)) for s in sentences]
    try:
        for i, task in enumerate(tasks):
            if interrupted.is_set():
                print(f"Interrupted during TTS (sentence {i+1}/{len(sentences)})")
                return

            try:
                mp3 = await task
            except Exception as e:  # noqa: BLE001
                print(f"tts error: {e}")
                continue

            if interrupted.is_set():
                return
            if not mp3:
                continue

            await ws.send_text(json.dumps({
                "type": "audio_chunk",
                "audio": base64.b64encode(mp3).decode(),
                "index": i,
            }))
    finally:
        # On interrupt/disconnect, don't leave synthesis running in the background.
        # Await the cancellations so httpx connections unwind before the next turn.
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)

    print(f"TTS ({time.time() - tts_start:.2f}s): {len(sentences)} sentences")
    if not interrupted.is_set():
        await ws.send_text(json.dumps({
            "type": "audio_end",
            "tts_time": round(time.time() - tts_start, 2),
        }))


@app.websocket("/ws")
async def websocket_endpoint(ws: WebSocket):
    await ws.accept()

    interrupted = asyncio.Event()
    msg_queue: asyncio.Queue = asyncio.Queue()

    async def receiver():
        """Receive messages from WebSocket and route them."""
        try:
            while True:
                raw = await ws.receive_text()
                msg = json.loads(raw)
                if msg.get("type") == "interrupt":
                    interrupted.set()
                    print("Client interrupted")
                else:
                    await msg_queue.put(msg)
        except WebSocketDisconnect:
            await msg_queue.put(None)

    recv_task = asyncio.create_task(receiver())

    try:
        while True:
            msg = await msg_queue.get()
            if msg is None:
                break

            interrupted.clear()

            text = (msg.get("text") or "").strip()
            image = msg.get("image")
            if not text and not image:
                continue

            text_response, llm_time = await _reply_text(text, image, camera_context(text, image))
            print(f"LLM ({llm_time:.2f}s) heard: {text!r} → {text_response}")

            if interrupted.is_set():
                print("Interrupted after LLM, skipping response")
                continue

            await ws.send_text(json.dumps({
                "type": "text",
                "text": text_response,
                "llm_time": round(llm_time, 2),
            }))

            if interrupted.is_set():
                print("Interrupted before TTS, skipping audio")
                continue

            await _stream_tts(ws, text_response, interrupted)

    except WebSocketDisconnect:
        print("Client disconnected")
    finally:
        recv_task.cancel()


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=config.PORT)
