import json
import logging
import os
import re
from typing import Optional

import requests

from .fal_client import chat_completion
from .router import normalize_chat_model, MODEL_KNOWLEDGE_CUTOFF

logger = logging.getLogger(__name__)


LLAMA3_CLASSIFIER_MODEL = "meta-llama/llama-3-8b-instruct"


RETRIEVAL_CLASSIFIER_SYSTEM = """
You are a classifier that decides how important real-time / external retrieval
(web search, news, APIs, up-to-date docs) is for answering a user question.

Return ONLY a JSON object with a single key "score" (float 0.0–1.0):

- 0.0: retrieval clearly NOT needed; static knowledge is enough
- 0.3: retrieval may help but is optional
- 0.7: retrieval strongly recommended
- 1.0: retrieval is essential (must not answer without it)

Guidelines (English or Korean queries both apply):
- Questions about current events, versions, prices, availability, or time-sensitive facts
  → higher score (0.7–1.0)
- Questions requiring very detailed domain data (e.g., specific APIs, configs, error codes)
  → medium score (0.3–0.7)
- Pure reasoning, math, generic coding, or timeless factual knowledge
  → low score (0.0–0.3)

Output format (EXACTLY):

{"score": 0.0}
""".strip()


def _clamp_score(value: float) -> float:
    return max(0.0, min(1.0, value))


# 질문에 포함되면 검색을 강제할 키워드 (최소 점수 0.7 부여)
RETRIEVAL_KEYWORD_BOOST = frozenset({
    "최신 뉴스", "최신뉴스", "최신 소식", "최신소식", "최신 동향", "최신동향",
    "최신", "실시간", "오늘의", "오늘 뉴스", "요즘", "최근 뉴스", "최근 소식",
    "current news", "latest news", "breaking news", "recent news", "today's news",
    "real-time", "realtime", "up-to-date", "up to date", "현재", "지금", "오늘", "최근"
})


def _keyword_retrieval_boost(user_query: str) -> float:
    """명시적으로 최신/실시간 정보를 요청하는 질문이면 최소 0.7 반환."""
    if not (user_query and user_query.strip()):
        return 0.0
    q = user_query.strip().lower()
    for kw in RETRIEVAL_KEYWORD_BOOST:
        if kw.lower() in q:
            return 0.7
    return 0.0


def _parse_score(raw: str) -> float:
    """
    Best-effort parsing of a float score from model output.
    Prefers JSON, falls back to first float-like token.
    """
    # 1) JSON 전체 시도
    try:
        data = json.loads(raw)
        if isinstance(data, dict) and "score" in data:
            return _clamp_score(float(data["score"]))
    except Exception:
        pass

    # 2) 응답 안에서 JSON 부분만 추출
    m = re.search(r"\{.*\}", raw, re.S)
    if m:
        try:
            data = json.loads(m.group(0))
            if isinstance(data, dict) and "score" in data:
                return _clamp_score(float(data["score"]))
        except Exception:
            pass

    # 3) 숫자 토큰만 있는 경우 (예: "0.42")
    m = re.search(r"(0(?:\.\d+)?|1(?:\.0+)?)", raw)
    if m:
        try:
            return _clamp_score(float(m.group(1)))
        except Exception:
            pass

    logger.warning("get_retrieval_score: could not parse score from output: %r", raw)
    return 0.0


def _retrieval_score_via_vertex(user_query: str, system_prompt: str) -> Optional[float]:
    """
    Vertex AI Gemini로 검색 필요성 점수 판별. Vertex 설정이 있을 때만 호출.
    성공 시 0.0~1.0 반환, 실패 시 None.
    """
    project = _vertex_project_id()
    location = os.environ.get("GOOGLE_CLOUD_LOCATION", "us-central1").strip()
    use_vertex = os.environ.get("GOOGLE_GENAI_USE_VERTEXAI", "").strip().lower() in ("1", "true", "yes")
    if not project or not use_vertex:
        return None
    try:
        from google import genai
        from google.genai.types import GenerateContentConfig, HttpOptions
    except ImportError:
        return None
    prompt = f"User question:\n{user_query}\n\nReturn the JSON score now."
    try:
        client = genai.Client(
            vertexai=True,
            project=project,
            location=location,
            http_options=HttpOptions(api_version="v1"),
        )
        response = client.models.generate_content(
            model=VERTEX_SEARCH_MODEL,
            contents=prompt,
            config=GenerateContentConfig(
                system_instruction=[system_prompt],
                temperature=0.0,
                max_output_tokens=64,
            ),
        )
        if response and response.text:
            return _parse_score(response.text.strip())
    except Exception as e:
        logger.debug("get_retrieval_score vertex classifier: %s", e)
    return None


def get_retrieval_score(user_query: str, model: Optional[str] = None, debug: bool = False) -> float:
    """
    Llama 3 8B 모델을 판별기로 사용해
    주어진 질문에 대한 '검색 필요성 점수'(0.0~1.0)를 반환한다.
    model 이 주어지면 해당 채팅 모델의 지식 컷오프를 판별기 프롬프트에 포함해
    컷오프 이후 정보가 필요할 때 검색 점수를 높인다.
    """
    system_prompt = RETRIEVAL_CLASSIFIER_SYSTEM
    if model:
        normalized = normalize_chat_model(model)
        cutoff = MODEL_KNOWLEDGE_CUTOFF.get(normalized)
        if cutoff is not None:
            cutoff_str = cutoff.strftime("%Y-%m")
            system_prompt = (
                f"{system_prompt}\n\n"
                f"The model that will answer the user has knowledge only up to {cutoff_str}. "
                "If the question concerns events, facts, or updates after that date, assign a higher retrieval score (0.5–1.0)."
            )
        else:
            system_prompt = (
                f"{system_prompt}\n\n"
                "The answering model's knowledge cutoff is unknown. If the question seems time-sensitive or about recent events, prefer a higher retrieval score."
            )

    prompt = f"User question:\n{user_query}\n\nReturn the JSON score now."

    # Vertex 설정이 있으면 판별기에 Vertex Gemini 사용 (검색 단계와 동일한 인프라)
    score = _retrieval_score_via_vertex(user_query, system_prompt)
    if score is not None:
        if debug:
            logger.info("get_retrieval_score vertex score=%.2f", score)
        return max(score, _keyword_retrieval_boost(user_query))

    # fallback: Llama (FAL/OpenRouter)
    try:
        raw = chat_completion(
            prompt=prompt,
            model=LLAMA3_CLASSIFIER_MODEL,
            system_prompt=system_prompt,
            temperature=0.0,
            max_tokens=64,
        )
    except Exception as e:
        logger.warning("get_retrieval_score: classifier call failed: %s", e)
        return _keyword_retrieval_boost(user_query)  # 실패 시에도 키워드면 검색 사용

    if debug:
        logger.info("get_retrieval_score raw output: %s", raw)

    score = _parse_score(str(raw))
    # '최신 뉴스' 등 명시적 키워드가 있으면 최소 0.7 보장
    return max(score, _keyword_retrieval_boost(user_query))


GEMINI_SEARCH_MODEL = os.environ.get("GEMINI_SEARCH_MODEL", "gemini-2.0-flash")

# Google Custom Search API (실제 웹 검색)
CUSTOM_SEARCH_BASE = "https://customsearch.googleapis.com/customsearch/v1"


def google_custom_search_snippets(query: str, num: int = 10) -> str:
    """
    Google Custom Search JSON API로 실제 웹 검색을 수행하고,
    결과 제목·스니펫·URL을 하나의 텍스트로 반환한다.
    env: GOOGLE_CUSTOM_SEARCH_API_KEY, GOOGLE_CSE_CX(검색엔진 ID) 필요.
    """
    api_key = os.environ.get("GOOGLE_CUSTOM_SEARCH_API_KEY", "").strip()
    cx = os.environ.get("GOOGLE_CSE_CX", "").strip()
    if not api_key or not cx:
        logger.warning(
            "google_custom_search_snippets: GOOGLE_CUSTOM_SEARCH_API_KEY or GOOGLE_CSE_CX not set. "
            "Set both in infra/.env and pass to worker (docker compose restart worker)."
        )
        return ""

    params = {
        "key": api_key,
        "cx": cx,
        "q": query,
        "num": min(10, max(1, num)),
    }
    try:
        resp = requests.get(CUSTOM_SEARCH_BASE, params=params, timeout=15)
    except requests.RequestException as e:
        logger.warning("google_custom_search_snippets: request failed: %s", e)
        return ""

    if not resp.ok:
        logger.warning(
            "google_custom_search_snippets: status=%s body=%s",
            resp.status_code,
            resp.text[:400],
        )
        if resp.status_code == 403 and "Custom Search JSON API" in (resp.text or ""):
            logger.warning(
                "Custom Search 403: Google이 신규 프로젝트에 Custom Search JSON API 접근을 제한할 수 있습니다. "
                "1) API 사용 설정·결제·동일 프로젝트 확인 후에도 403이면, 예전에 만든(2024년 이전) GCP 프로젝트의 API 키로 시도해 보세요. "
                "2) 대안: Vertex AI Search 또는 SerpAPI/Brave Search 등 서드파티 검색 API 연동을 검토하세요."
            )
        return ""

    try:
        data = resp.json()
        items = data.get("items") or []
    except Exception as e:
        logger.warning("google_custom_search_snippets: parse failed: %s", e)
        return ""

    if not items:
        return ""

    lines = []
    for i, item in enumerate(items, start=1):
        title = (item.get("title") or "").strip()
        snippet = (item.get("snippet") or "").strip()
        link = (item.get("link") or "").strip()
        if title or snippet:
            lines.append(f"[{i}] {title}")
            if snippet:
                lines.append(snippet)
            if link:
                lines.append(f"URL: {link}")
            lines.append("")
    return "\n".join(lines).strip()


# Vertex AI Google Search grounding (Custom Search JSON API 대체)
VERTEX_SEARCH_MODEL = os.environ.get("VERTEX_SEARCH_MODEL", "gemini-2.0-flash-001")


def _vertex_project_id() -> str:
    """Vertex AI용 프로젝트 ID (문자열). 번호만 있으면 서비스 계정 JSON에서 project_id 읽기."""
    project = os.environ.get("GOOGLE_CLOUD_PROJECT", "").strip()
    if project and not project.isdigit():
        return project
    creds_path = os.environ.get("GOOGLE_APPLICATION_CREDENTIALS", "").strip()
    if creds_path and os.path.isfile(creds_path):
        try:
            with open(creds_path, encoding="utf-8") as f:
                data = json.load(f)
                pid = (data.get("project_id") or "").strip()
                if pid:
                    return pid
        except Exception:
            pass
    return project or ""


def vertex_ai_google_search_context(query: str, max_tokens: int = 2048) -> str:
    """
    Vertex AI Gemini + Google Search grounding으로 질문에 대한 최신 웹 기반 요약을 반환.
    env: GOOGLE_CLOUD_PROJECT(프로젝트 ID 문자열 권장), GOOGLE_CLOUD_LOCATION(기본 us-central1),
         GOOGLE_GENAI_USE_VERTEXAI=True, GOOGLE_APPLICATION_CREDENTIALS(서비스 계정 JSON 경로).
    """
    project = _vertex_project_id()
    location = os.environ.get("GOOGLE_CLOUD_LOCATION", "us-central1").strip()
    use_vertex = os.environ.get("GOOGLE_GENAI_USE_VERTEXAI", "").strip().lower() in ("1", "true", "yes")
    if not project or not use_vertex:
        return ""

    try:
        from google import genai
        from google.genai.types import GenerateContentConfig, GoogleSearch, HttpOptions, Tool
    except ImportError:
        logger.warning("vertex_ai_google_search_context: google-genai not installed. pip install google-genai")
        return ""

    prompt = (
        f"다음 질문에 대해 Google 검색을 사용해 최신 정보를 찾고, "
        f"핵심 사실만 한국어로 간단히 요약해 주세요. 출처 제목이나 URL이 있다면 함께 적어 주세요.\n\n질문: {query}"
    )
    try:
        client = genai.Client(
            vertexai=True,
            project=project,
            location=location,
            http_options=HttpOptions(api_version="v1"),
        )
        response = client.models.generate_content(
            model=VERTEX_SEARCH_MODEL,
            contents=prompt,
            config=GenerateContentConfig(
                tools=[Tool(google_search=GoogleSearch())],
                temperature=1.0,
                max_output_tokens=max_tokens,
            ),
        )
        if response and response.text:
            return response.text.strip()
        return ""
    except Exception as e:
        logger.warning("vertex_ai_google_search_context: %s", e)
        return ""


def get_web_search_context(query: str, num: int = 10) -> str:
    """
    웹 검색 기반 외부 컨텍스트 반환. Vertex AI Google Search grounding 우선, 없으면 Custom Search JSON API.
    """
    ctx = vertex_ai_google_search_context(query, max_tokens=2048)
    if ctx:
        return ctx
    return google_custom_search_snippets(query, num=num)


def gemini_search_snippets(query: str, max_tokens: int = 2048) -> str:
    """
    Gemini API를 사용해 웹/검색 결과 요약 텍스트를 가져온다.
    실제로는 'grounding' 기능이 있는 엔드포인트를 쓰는 것이 좋지만,
    여기서는 단순 generateContent 예시만 보여준다.
    """
    api_key = os.environ.get("GEMINI_API_KEY", "").strip()
    if not api_key:
        logger.debug("gemini_search_snippets: GEMINI_API_KEY not set, skipping external search.")
        return ""

    url = f"https://generativelanguage.googleapis.com/v1beta/models/{GEMINI_SEARCH_MODEL}:generateContent"
    headers = {"Content-Type": "application/json"}
    body = {
        "contents": [
            {
                "parts": [
                    {
                        "text": (
                            "다음 질문에 대해, 최신 공개 웹 정보를 기반으로 핵심 사실만 한국어로 요약해 주세요. "
                            "출처가 불명확하거나 추측인 내용은 포함하지 마세요.\n\n"
                            f"질문: {query}"
                        )
                    }
                ]
            }
        ],
        "generationConfig": {
            "temperature": 0.1,
            "maxOutputTokens": max_tokens,
        },
    }

    try:
        resp = requests.post(f"{url}?key={api_key}", headers=headers, json=body, timeout=30)
    except requests.RequestException as e:
        logger.warning("gemini_search_snippets: request failed: %s", e)
        return ""

    if not resp.ok:
        logger.warning(
            "gemini_search_snippets: non-OK response: status=%s body=%s",
            resp.status_code,
            resp.text[:500],
        )
        return ""

    try:
        data = resp.json()
        return (
            data.get("candidates", [{}])[0]
            .get("content", {})
            .get("parts", [{}])[0]
            .get("text", "")
        )
    except Exception as e:
        logger.warning("gemini_search_snippets: failed to parse response JSON: %s", e)
        return ""

