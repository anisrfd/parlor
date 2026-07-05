"""Gateway to the Node glue service.

Encapsulates every HTTP call to the Node layer behind two intention-revealing async
methods, so the WebSocket orchestration depends on this small interface rather than on
httpx and URL paths. An httpx client can be injected for testing.
"""

import httpx


class NodeClient:
    def __init__(self, base_url: str, *, timeout: float = 40.0, client: httpx.AsyncClient | None = None):
        self._base_url = base_url.rstrip("/")
        self._client = client or httpx.AsyncClient(
            base_url=self._base_url, timeout=httpx.Timeout(timeout)
        )

    async def infer(self, text: str, image: str | None = None, context: str | None = None) -> str:
        """Ask the reasoning provider (Gemma) for a Bengali reply."""
        payload: dict = {"text": text}
        if image:
            payload["image"] = image
        if context:
            payload["context"] = context
        resp = await self._client.post("/infer", json=payload)
        resp.raise_for_status()
        return resp.json().get("response", "")

    async def synthesize(self, sentence: str) -> bytes:
        """Ask the voice provider (edge-tts) for MP3 audio of one sentence."""
        resp = await self._client.post("/tts", json={"text": sentence})
        resp.raise_for_status()
        return resp.content

    async def aclose(self) -> None:
        await self._client.aclose()
