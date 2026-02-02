import os
import logging
from openai import OpenAI
from pgvector.django import CosineDistance
from django.conf import settings
from .models import ChatMemory, Session

logger = logging.getLogger(__name__)

class ChatMemoryService:
    def __init__(self):
        # Allow override via settings or env
        api_key = getattr(settings, 'OPENAI_API_KEY', os.environ.get("OPENAI_API_KEY"))
        if api_key:
            self.client = OpenAI(api_key=api_key)
        else:
            self.client = None
            logger.warning("OPENAI_API_KEY not found. RAG functionality will be limited.")

    def embed_text(self, text: str) -> list[float]:
        """Generates embedding for the given text using OpenAI."""
        if not self.client:
            # Return zero vector if no client (for testing/dev safety)
            return [0.0] * 1536

        try:
            response = self.client.embeddings.create(
                input=text,
                model="text-embedding-3-small"
            )
            return response.data[0].embedding
        except Exception as e:
            logger.error(f"Error generating embedding: {e}")
            return [0.0] * 1536

    def add_memory(self, session_id: int, content: str, metadata: dict = None):
        """Adds a memory item to the vector store."""
        if not content:
            return

        embedding = self.embed_text(content)
        ChatMemory.objects.create(
            session_id=session_id,
            content=content,
            embedding=embedding,
            metadata=metadata or {}
        )

    def search_memory(self, session_ids: list[int], query: str, limit: int = 5):
        """Retrieves relevant memories based on semantic similarity."""
        embedding = self.embed_text(query)

        # Filter by sessions
        qs = ChatMemory.objects.filter(session_id__in=session_ids)

        # Order by Cosine Distance (smaller is closer)
        return qs.order_by(CosineDistance('embedding', embedding))[:limit]

# Singleton instance
memory_service = ChatMemoryService()
