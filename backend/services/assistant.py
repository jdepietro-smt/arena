"""
Ops assistant — answers natural-language questions about live system state
("why is Camera 3 down?") by handing the model a JSON snapshot of current
streams/alerts/events alongside the question.

Calls the Anthropic Messages API directly over httpx (already a dependency)
rather than adding the anthropic SDK for what is a single request/response
call with no streaming or tool use.
"""

from __future__ import annotations

import json
import logging

import httpx

from ..config import settings

logger = logging.getLogger(__name__)

_ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages"
_ANTHROPIC_VERSION = "2023-06-01"
_MODEL = "claude-haiku-4-5-20251001"
_MAX_TOKENS = 500

_SYSTEM_PROMPT = (
    "You are ArenaHub's ops assistant, embedded in a broadcast stream "
    "management dashboard. You are given a JSON snapshot of live stream, "
    "alert, and event state, followed by a question from a broadcast "
    "operator. Answer concisely and specifically, referencing only the "
    "actual data in the snapshot — never invent stream names, numbers, or "
    "events that aren't present. If the snapshot doesn't contain enough to "
    "answer, say so plainly instead of guessing."
)


async def ask(question: str, context: dict) -> str:
    if not settings.ANTHROPIC_API_KEY:
        raise RuntimeError("The ops assistant isn't configured — set ANTHROPIC_API_KEY.")

    payload = {
        "model": _MODEL,
        "max_tokens": _MAX_TOKENS,
        "system": _SYSTEM_PROMPT,
        "messages": [
            {
                "role": "user",
                "content": f"Current system snapshot:\n{json.dumps(context, default=str)}\n\nQuestion: {question}",
            }
        ],
    }
    headers = {
        "x-api-key": settings.ANTHROPIC_API_KEY,
        "anthropic-version": _ANTHROPIC_VERSION,
        "content-type": "application/json",
    }

    try:
        async with httpx.AsyncClient(timeout=20.0) as client:
            resp = await client.post(_ANTHROPIC_API_URL, json=payload, headers=headers)
    except httpx.RequestError as exc:
        logger.error("Ops assistant request failed: %s", exc)
        raise RuntimeError("Could not reach the ops assistant. Try again shortly.")

    if resp.status_code != 200:
        logger.error("Anthropic API error %s: %s", resp.status_code, resp.text)
        raise RuntimeError(f"Ops assistant request failed ({resp.status_code}).")

    data = resp.json()
    parts = [block["text"] for block in data.get("content", []) if block.get("type") == "text"]
    answer = "\n".join(parts).strip()
    return answer or "I couldn't generate an answer for that."
