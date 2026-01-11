import json
import redis
from typing import Dict, Any
from app.core.config import settings

from redis import Redis

# Dedicated PubSub connection
redis_pub: Redis = redis.from_url(settings.REDIS_URL)

def publish_event(debate_id: str, event_type: str, payload: Dict[str, Any]):
    """
    Publish a structured event to the debate channel.
    Channel: debate:{debate_id}
    Format: JSON {event: 'name', data: {...}}
    """
    channel = f"debate:{debate_id}"
    message = json.dumps({
        "event": event_type,
        "data": payload
    })
    redis_pub.publish(channel, message)
