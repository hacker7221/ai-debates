import json
from typing import AsyncGenerator, Dict, Any
from fastapi import APIRouter, Request
from sse_starlette.sse import EventSourceResponse
from redis import asyncio as aioredis
from app.core.config import settings

router = APIRouter()

@router.get("/{debate_id}/stream")
async def stream_debate(debate_id: str, request: Request) -> EventSourceResponse:
    """
    SSE Endpoint for streaming debate events.
    Subscribes to Redis channel 'debate:{debate_id}'
    """
    async def event_generator() -> AsyncGenerator[Dict[str, Any], None]:
        redis = await aioredis.from_url(settings.REDIS_URL, decode_responses=True)
        pubsub = redis.pubsub()
        channel = f"debate:{debate_id}"
        await pubsub.subscribe(channel)
        
        try:
            # Yield initial connection message
            yield {
                "event": "connected", 
                "data": json.dumps({"message": "Monitor connected"})
            }

            async for message in pubsub.listen():
                if await request.is_disconnected():
                    break
                    
                if isinstance(message, dict) and message.get("type") == "message":
                    # Parse Redis message (which is JSON stringified in orchestrator)
                    payload_str: str = str(message.get("data"))
                    try:
                        payload: Dict[str, Any] = json.loads(payload_str)
                        # We expect payload to have 'event' and 'data' keys
                        event_type = str(payload.get("event", "update"))
                        event_data = payload.get("data", {})
                        
                        yield {
                            "event": event_type,
                            "data": json.dumps(event_data)
                        }
                        
                        # Stop stream if debate completed
                        if event_type == "debate_completed":
                            break
                            
                    except json.JSONDecodeError:
                        print("Failed to decode Redis message")
                        
        finally:
            await pubsub.unsubscribe(channel)
            await redis.close()

    return EventSourceResponse(event_generator())
