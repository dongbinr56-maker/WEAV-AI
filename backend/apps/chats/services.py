import os
import logging
import re
import json
from typing import Optional
from openai import OpenAI
import requests
from pgvector.django import CosineDistance
from django.conf import settings
from django.db.models import Case, IntegerField, Value, When
from django.db.models.functions import Cast
from .models import ChatMemory, Session
try:
    from apps.ai.router import run_chat
except Exception:
    run_chat = None

logger = logging.getLogger(__name__)

class ChatMemoryService:
    def __init__(self):
        # Use fal OpenRouter embeddings (OpenAI-compatible)
        api_key = getattr(settings, 'FAL_KEY', os.environ.get("FAL_KEY"))
        self.embedding_model = getattr(
            settings,
            'OPENROUTER_EMBEDDING_MODEL',
            os.environ.get("OPENROUTER_EMBEDDING_MODEL", "openai/text-embedding-3-small"),
        )
        self.rerank_enabled = os.environ.get("RERANK_ENABLED", "1") == "1"
        self.rerank_model = os.environ.get("RERANK_MODEL", "openai/gpt-4o-mini")
        self.rerank_max_candidates = int(os.environ.get("RERANK_MAX_CANDIDATES", "24"))
        if api_key:
            self.client = OpenAI(
                base_url="https://fal.run/openrouter/router/openai/v1",
                api_key="not-needed",
                default_headers={"Authorization": f"Key {api_key}"},
            )
        else:
            self.client = None
            logger.warning("FAL_KEY not found. RAG functionality will be limited.")

    def embed_text(self, text: str) -> list[float]:
        """Generates embedding for the given text using OpenAI."""
        if not self.client:
            # Return zero vector if no client (for testing/dev safety)
            return [0.0] * 1536

        try:
            response = self.client.embeddings.create(
                input=text,
                model=self.embedding_model
            )
            return response.data[0].embedding
        except Exception as e:
            logger.error(f"Error generating embedding: {e}")
            return [0.0] * 1536

    def ocr_image_with_fal(self, image_url: str) -> str:
        """
        Uses fal.ai Vision model (Llava-Next) to extract text from an image URL.
        """
        import time
        api_key = getattr(settings, 'FAL_KEY', os.environ.get("FAL_KEY"))
        if not api_key:
            logger.warning("FAL_KEY not set. Skipping image OCR.")
            return ""

        # Attempt to use fal_client if available
        try:
            import fal_client
            handler = fal_client.submit(
                "fal-ai/llava-next",
                arguments={
                    "image_url": image_url,
                    "prompt": "Extract all text from this image exactly as it appears. If there is no text, return an empty string.",
                    "max_tokens": 1024
                },
            )
            result = handler.get()
            output = result.get('output', '')
            # Sometimes output is a dict or list depending on model
            if isinstance(output, list):
                return " ".join([str(o) for o in output])
            return str(output)
        except ImportError:
            # Fallback to direct HTTP request with polling (simplified)
            # This is a bit risky due to complexity but necessary if fal_client is missing
            try:
                queue_url = "https://queue.fal.run/fal-ai/llava-next"
                headers = {
                    "Authorization": f"Key {api_key}",
                    "Content-Type": "application/json"
                }
                payload = {
                    "image_url": image_url,
                    "prompt": "Extract all text from this image exactly as it appears. If there is no text, return an empty string.",
                    "max_tokens": 1024
                }
                
                resp = requests.post(queue_url, headers=headers, json=payload, timeout=30)
                if resp.status_code == 200:
                    job = resp.json()
                    request_id = job.get('request_id')
                    if request_id:
                        # Poll
                        status_url = f"https://queue.fal.run/fal-ai/llava-next/requests/{request_id}/status"
                        for _ in range(15): # 30s
                            time.sleep(2)
                            s_resp = requests.get(status_url, headers=headers, timeout=10)
                            if s_resp.status_code == 200:
                                s_data = s_resp.json()
                                if s_data.get('status') == 'COMPLETED':
                                    res_url = f"https://queue.fal.run/fal-ai/llava-next/requests/{request_id}"
                                    r_resp = requests.get(res_url, headers=headers, timeout=10)
                                    if r_resp.status_code == 200:
                                        out = r_resp.json().get('output', '')
                                        if isinstance(out, list):
                                            return " ".join([str(o) for o in out])
                                        return str(out)
                                    break
                                elif s_data.get('status') == 'FAILED':
                                    break
            except Exception as e:
                logger.error(f"Fal.ai direct request failed: {e}")
            return ""
        except Exception as e:
            logger.error(f"Fal.ai client extracted failed: {e}")
            return ""

    def _tokenize_query(self, query: str) -> list[str]:
        if not query:
            return []
        tokens = re.findall(r"[0-9]{4}[./-]?[0-9]{1,2}[./-]?[0-9]{1,2}|[A-Za-z0-9]+|[가-힣]+", query)
        tokens = [t for t in tokens if len(t) >= 2]
        extra: list[str] = []
        if any(k in query for k in ("언제", "기간", "신청", "모집", "접수")):
            extra += ["기간", "모집기간", "신청기간", "접수기간", "모집 기간", "신청 기간", "접수 기간"]
        if any(k in query for k in ("여성", "여자", "남성", "남자")):
            extra += ["여성", "여자", "남성", "남자", "남성만", "남자만"]
        if "모집" in query:
            extra += ["모집대상", "모집 대상"]
        if any(k in query for k in ("취지", "목적", "의의", "목표")):
            extra += [
                "취지",
                "목적",
                "의의",
                "목표",
                "사업 목적",
                "사업 취지",
                "지원 목적",
                "지원 취지",
                "추진 목적",
                "추진 취지",
                "지원 계획",
                "보조",
                "지원",
            ]
        if any(k in query for k in ("사업", "지원", "보조")):
            extra += [
                "사업",
                "지원사업",
                "보조사업",
                "지원 계획",
                "지원 내용",
                "사업 개요",
                "사업 목적",
                "추진 배경",
            ]
        if "자격" in query:
            extra += ["자격", "대상", "요건"]
        combined = tokens + extra
        # dedupe while preserving order
        seen = set()
        unique = []
        for t in combined:
            if t in seen:
                continue
            seen.add(t)
            unique.append(t)
        return unique[:8]

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

    def _keyword_search(self, qs, query: str, limit: int) -> tuple[list[ChatMemory], bool]:
        tokens = self._tokenize_query(query)
        if tokens:
            score_expr = Value(0, output_field=IntegerField())
            for token in tokens:
                score_expr = score_expr + Case(
                    When(content__icontains=token, then=Value(1)),
                    default=Value(0),
                    output_field=IntegerField(),
                )
            scored = qs.annotate(
                score=score_expr,
                page_num=Cast('metadata__page', IntegerField()),
            ).order_by('-score', 'page_num', 'id')
            results = list(scored[:limit])
            if results and getattr(results[0], 'score', 0) > 0:
                return results, True
        results = list(
            qs.annotate(
                page_num=Cast('metadata__page', IntegerField()),
            ).order_by('page_num', 'id')[:limit]
        )
        return results, False

    def _rrf_merge(self, vector_results: list[ChatMemory], keyword_results: list[ChatMemory], k: int = 60) -> list[ChatMemory]:
        if not vector_results and not keyword_results:
            return []
        scores: dict[int, float] = {}
        items: dict[int, ChatMemory] = {}
        for rank, item in enumerate(vector_results):
            scores[item.id] = scores.get(item.id, 0.0) + 1.0 / (k + rank + 1)
            items[item.id] = item
        for rank, item in enumerate(keyword_results):
            scores[item.id] = scores.get(item.id, 0.0) + 1.0 / (k + rank + 1)
            items[item.id] = item
        ranked_ids = sorted(scores.keys(), key=lambda i: scores[i], reverse=True)
        return [items[i] for i in ranked_ids]

    def _rerank_with_llm(self, query: str, candidates: list[ChatMemory], limit: int) -> list[ChatMemory]:
        if not self.rerank_enabled or not run_chat or not candidates:
            return candidates[:limit]
        if os.environ.get('FAL_KEY', '') == '':
            return candidates[:limit]
        top_k = min(len(candidates), self.rerank_max_candidates)
        items = candidates[:top_k]
        lines = []
        for idx, item in enumerate(items, start=1):
            snippet = (item.content or "").replace("\n", " ").strip()
            if len(snippet) > 320:
                snippet = snippet[:320] + "..."
            page = (item.metadata or {}).get('page')
            lines.append(f"[{idx}] (p.{page}) {snippet}")
        system_prompt = (
            "You are a ranking model. Return ONLY JSON with a single key 'ranking' "
            "that lists the most relevant passage indices in descending order. "
            "Example: {\"ranking\":[3,1,2]}. Do not include any other text."
        )
        prompt = f"Query: {query}\n\nPassages:\n" + "\n".join(lines)
        try:
            output = run_chat(prompt, model=self.rerank_model, system_prompt=system_prompt, temperature=0, max_tokens=200)
            # Parse JSON
            match = re.search(r"\{.*\}", output, re.S)
            if match:
                payload = json.loads(match.group(0))
                ranking = payload.get("ranking", [])
                ranked = []
                seen = set()
                for idx in ranking:
                    if not isinstance(idx, int):
                        continue
                    if 1 <= idx <= len(items):
                        item = items[idx - 1]
                        if item.id in seen:
                            continue
                        seen.add(item.id)
                        ranked.append(item)
                if ranked:
                    # append remaining in original order
                    for item in items:
                        if item.id not in seen:
                            ranked.append(item)
                    return ranked[:limit]
        except Exception as e:
            logger.warning(f"Rerank failed: {e}")
        return candidates[:limit]

    def search_memory(self, session_ids: list[int], query: str, limit: int = 5, document_id: Optional[int] = None, exclude_sources: Optional[list[str]] = None):
        """Retrieves relevant memories based on semantic similarity."""
        # Filter by sessions
        qs = ChatMemory.objects.filter(session_id__in=session_ids)
        if document_id is not None:
            qs = qs.filter(metadata__document_id=document_id)
        if exclude_sources:
            qs = qs.exclude(metadata__source__in=exclude_sources)

        if not self.client:
            results, _ = self._keyword_search(qs, query, limit)
            return results

        candidate_limit = max(limit * 4, 20)
        embedding = self.embed_text(query)
        # Order by Cosine Distance (smaller is closer)
        keyword_results, keyword_hit = self._keyword_search(qs, query, candidate_limit)
        vector_results = list(qs.order_by(CosineDistance('embedding', embedding))[:candidate_limit])
        if not vector_results:
            return keyword_results

        tokens = self._tokenize_query(query)
        if tokens:
            critical_tokens: list[str] = []
            if any(k in query for k in ("남자", "남성", "여자", "여성")):
                critical_tokens = ["남자", "남성", "남자만", "남성만", "여자", "여성", "여자만", "여성만"]
            if any(k in query for k in ("취지", "목적", "의의", "목표")):
                critical_tokens += [
                    "취지",
                    "목적",
                    "의의",
                    "목표",
                    "사업 목적",
                    "사업 취지",
                    "지원 목적",
                    "지원 취지",
                    "추진 목적",
                    "추진 취지",
                    "지원 계획",
                ]
            best_score = 0
            for item in vector_results:
                content = (item.content or "")
                score = sum(1 for token in tokens if token in content)
                if score > best_score:
                    best_score = score
            if critical_tokens:
                has_critical = any(
                    any(token in (item.content or "") for token in critical_tokens)
                    for item in vector_results
                )
                if not has_critical:
                    if keyword_hit:
                        return keyword_results[:limit]
            if best_score == 0:
                if keyword_hit:
                    return keyword_results[:limit]

        merged = self._rrf_merge(vector_results, keyword_results)
        rerank_all = os.environ.get("RERANK_ALL", "0") == "1"
        if self.rerank_enabled and (document_id is not None or rerank_all):
            merged = self._rerank_with_llm(query, merged, limit)
        return merged[:limit]

    def get_relevant_context(self, session_id: int, query: str, max_chars: int = 3000) -> str:
        """
        Retrieves relevant context for the given query within the character limit.
        Returns a JSON-formatted string with citations:
        {
            "instructions": "Use the provided context to answer. Cite sources using [Filename, Page X].",
            "context": [
                {"text": "...", "source": "file.pdf", "page": 1, "bbox": [x,y,w,h]}
            ]
        }
        """
        import json
        
        if not query:
            return ""

        # Fetch top relevant chunks
        memories = self.search_memory([session_id], query, limit=10)
        
        context_items = []
        current_length = 0
        
        for memory in memories:
            content = memory.content.strip()
            # Estimate JSON overhead per item ~100 chars
            if current_length + len(content) + 100 > max_chars:
                break
            
            # Extract metadata
            meta = memory.metadata or {}
            item = {
                "text": content,
                "source": meta.get('filename', 'chat_history'),
                "page": meta.get('page', 1),
                "bbox": meta.get('bbox', []),
                "type": meta.get('source', 'chat'),
                "image_url": meta.get('image_url'), # Added for UI
                "is_image_ocr": meta.get('is_image_ocr', False)
            }
            
            context_items.append(item)
            current_length += len(content) + 100
            
        # Construct final payload
        # Construct final payload
        payload = {
            "system_note": "답변 마지막에 반드시 출처를 명시하십시오. 형식: '해당 답변의 근거는 [파일명.pdf] [페이지 번호]장에 명시되어 있음'.",
            "relevant_context": context_items
        }
        
        return json.dumps(payload, ensure_ascii=False)

    def get_image_context(self, session_id: int) -> dict:
        """
        Retrieves context for image generation, specifically for Kling AI visual consistency.
        Returns:
            dict: {
                'seed': int,
                'reference_image_url': str,
                'mask_url': str,
                'multi_elements': list
            }
        """
        from .models import ImageRecord
        
        # Get latest image record to maintain continuity
        last_image = ImageRecord.objects.filter(session_id=session_id).first()
        if not last_image:
            return {}
            
        context = {
            'seed': last_image.seed,
            'reference_image_url': last_image.image_url, # Key for "Reference Image"
            'mask_url': last_image.mask_url,
            'multi_elements': last_image.metadata.get('multi_elements', []),
            # Pass other relevant metadata if needed
        }
        
        # Filter out None values
        return {k: v for k, v in context.items() if v is not None}

# Singleton instance
memory_service = ChatMemoryService()
