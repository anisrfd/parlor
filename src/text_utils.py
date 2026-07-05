"""Pure text helpers for the conversation pipeline (no I/O — trivially testable)."""

import re

# Bengali sentence boundaries: the danda (।) is the primary full stop, but ? and !
# are common too, and a Latin . shows up in mixed text. Split after any of them.
SENTENCE_SPLIT_RE = re.compile(r"(?<=[।?!.])\s+")

# Per-turn hints appended to the Node/Gemma request when a camera frame is present.
# The heavy lifting lives in the Node system prompt; these only steer the moment.
_CTX_IMAGE_ONLY = (
    "ব্যবহারকারী এই মুহূর্তে ক্যামেরায় কিছু দেখাচ্ছে। "
    "প্রাসঙ্গিক হলে যা দেখছ তা নিয়ে স্বাভাবিকভাবে মন্তব্য করো।"
)
_CTX_IMAGE_WITH_TEXT = (
    "ব্যবহারকারী কথা বলার সময় ক্যামেরায় কিছু দেখাচ্ছে। "
    "প্রাসঙ্গিক হলে যা দেখছ তা উল্লেখ করো।"
)


def split_sentences(text: str) -> list[str]:
    """Split Bengali (and mixed) text into sentences for streaming TTS."""
    parts = SENTENCE_SPLIT_RE.split(text.strip())
    return [s.strip() for s in parts if s.strip()]


def camera_context(text: str, image) -> str | None:
    """Return the Bengali per-turn hint for the given text/image combination."""
    if not image:
        return None
    return _CTX_IMAGE_ONLY if not text else _CTX_IMAGE_WITH_TEXT
