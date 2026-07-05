"""Tests for the Python orchestration server and its collaborators.

Run from src/:  ./.venv/bin/pytest

Hermetic — no Node service, no API key, no network. The NodeClient gateway is either
tested in isolation with a mocked httpx transport, or replaced with a fake so the
WebSocket orchestration can be exercised on its own.
"""

import asyncio
import base64
import sys
from pathlib import Path

import httpx
import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import server  # noqa: E402
from node_client import NodeClient  # noqa: E402
from text_utils import camera_context, split_sentences  # noqa: E402


# ── text_utils: Bengali sentence splitting ──

def test_split_on_danda():
    assert split_sentences("আমি ভালো আছি। তুমি কেমন আছো?") == [
        "আমি ভালো আছি।",
        "তুমি কেমন আছো?",
    ]


def test_split_on_bang_and_question():
    assert split_sentences("দারুণ! চলো যাই।") == ["দারুণ!", "চলো যাই।"]


def test_single_sentence_and_empty():
    assert split_sentences("একটি মাত্র বাক্য") == ["একটি মাত্র বাক্য"]
    assert split_sentences("   ") == []


def test_split_preserves_all_content():
    text = "প্রথম বাক্য। দ্বিতীয় বাক্য। তৃতীয় বাক্য।"
    parts = split_sentences(text)
    assert len(parts) == 3
    norm = lambda s: s.replace("।", "").replace(" ", "")
    assert norm("".join(parts)) == norm(text)


# ── text_utils: camera context selection ──

def test_camera_context():
    assert camera_context("", None) is None
    assert camera_context("হ্যালো", None) is None
    assert camera_context("", "IMG") is not None            # image only
    assert camera_context("হ্যালো", "IMG") is not None      # image + text
    # The two image cases produce different hints.
    assert camera_context("", "IMG") != camera_context("হ্যালো", "IMG")


# ── NodeClient gateway (mocked httpx transport, no network) ──

def test_node_client_infer_and_tts():
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/infer":
            return httpx.Response(200, json={"response": "হ্যালো"})
        if request.url.path == "/tts":
            return httpx.Response(200, content=b"\xff\xf3AUDIO")
        return httpx.Response(404)

    async def run():
        client = httpx.AsyncClient(base_url="http://node", transport=httpx.MockTransport(handler))
        node = NodeClient("http://node", client=client)
        assert await node.infer("কেমন আছো?", image="IMG", context="ctx") == "হ্যালো"
        assert (await node.synthesize("বাক্য")).startswith(b"\xff\xf3")
        await node.aclose()

    asyncio.run(run())


# ── WebSocket streaming protocol (fake gateway injected via lifespan) ──

class FakeNode:
    """Stands in for NodeClient; records calls and returns canned Bengali data."""

    def __init__(self, *_args, **_kwargs):
        pass

    async def infer(self, text, image=None, context=None):
        assert text  # server must forward the recognized text
        return "আমি ভালো আছি। ধন্যবাদ জিজ্ঞেস করার জন্য।"

    async def synthesize(self, sentence):
        assert sentence
        return b"\xff\xf3" + sentence.encode("utf-8")

    async def aclose(self):
        pass


@pytest.fixture
def fake_node(monkeypatch):
    # lifespan builds the gateway via NodeClient(...); swap the class for the fake.
    monkeypatch.setattr(server, "NodeClient", FakeNode)


def test_websocket_full_turn(fake_node):
    with TestClient(server.app) as client:
        with client.websocket_connect("/ws") as ws:
            ws.send_json({"text": "তুমি কেমন আছো?"})

            text_msg = ws.receive_json()
            assert text_msg["type"] == "text"
            assert "ভালো" in text_msg["text"]
            assert "llm_time" in text_msg

            start = ws.receive_json()
            assert start["type"] == "audio_start"
            assert start["mime"] == "audio/mpeg"
            assert start["sentence_count"] == 2  # reply split on the danda

            chunks = [ws.receive_json() for _ in range(2)]
            assert all(c["type"] == "audio_chunk" for c in chunks)
            assert [c["index"] for c in chunks] == [0, 1]
            assert base64.b64decode(chunks[0]["audio"]).startswith(b"\xff\xf3")

            end = ws.receive_json()
            assert end["type"] == "audio_end"
            assert "tts_time" in end


def test_websocket_interrupt_suppresses_audio_but_session_survives(fake_node, monkeypatch):
    """Barge-in mid-TTS: turn 1's audio is dropped, and turn 2 still works fully."""

    async def slow_synthesize(self, sentence):
        await asyncio.sleep(0.3)  # wide window for the interrupt to land mid-TTS
        return b"\xff\xf3" + sentence.encode("utf-8")

    monkeypatch.setattr(FakeNode, "synthesize", slow_synthesize)

    with TestClient(server.app) as client:
        with client.websocket_connect("/ws") as ws:
            # Turn 1 — interrupt as soon as the reply text arrives.
            ws.send_json({"text": "তুমি কেমন আছো?"})
            assert ws.receive_json()["type"] == "text"
            ws.send_json({"type": "interrupt"})

            # Turn 2 — must complete with audio despite the earlier interrupt.
            ws.send_json({"text": "আবার বলো।"})

            saw_turn2_text = False
            saw_audio_end = False
            for _ in range(12):  # generous upper bound on frames
                msg = ws.receive_json()
                if msg["type"] == "text":
                    saw_turn2_text = True
                if msg["type"] == "audio_chunk":
                    # Any chunk must belong to turn 2 (after its text arrived).
                    assert saw_turn2_text, "turn 1 audio leaked past the interrupt"
                if msg["type"] == "audio_end":
                    saw_audio_end = True
                    break
            assert saw_turn2_text and saw_audio_end


def test_websocket_ignores_empty_message(fake_node):
    """A message with neither text nor image should be skipped, not answered."""
    with TestClient(server.app) as client:
        with client.websocket_connect("/ws") as ws:
            ws.send_json({})                 # empty — ignored
            ws.send_json({"text": "হ্যালো"})  # real turn
            first = ws.receive_json()
            assert first["type"] == "text"
            assert "ভালো" in first["text"]
