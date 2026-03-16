from typing import Optional, Tuple
import logging
import re

from celery import shared_task
from django.db import transaction
from apps.chats.models import Message, ImageRecord, Job, Document
from apps.chats.services import memory_service
from .router import (
    run_chat,
    run_image,
    IMAGE_MODEL_GEMINI3_PRO_IMAGE,
    IMAGE_MODEL_KLING,
    IMAGE_MODEL_NANO_BANANA,
    IMAGE_MODEL_NANO_BANANA_EDIT,
    IMAGE_MODEL_NANO_BANANA_2,
    IMAGE_MODEL_NANO_BANANA_2_EDIT,
)
from .errors import AIError
from .utils import get_rag_enhanced_system_prompt, get_rag_context_string
from .system_rules import prepend_model_rule
from .retrieval import get_retrieval_score, get_web_search_context

logger = logging.getLogger(__name__)

DOC_MENTION_RE = re.compile(r'@([^\s]+)')
DOC_MENTION_QUOTED_RE = re.compile(r'@"([^"]+)"')
DOC_MENTION_QUOTED_SINGLE_RE = re.compile(r"@'([^']+)'")

def _clip_text(text: str, max_len: int = 280) -> str:
    if not text:
        return ""
    s = str(text).strip()
    if len(s) <= max_len:
        return s
    return s[: max_len - 1] + "…"


def _fallback_extract_doc_name(prompt: str) -> Optional[str]:
    if not prompt:
        return None
    match = DOC_MENTION_QUOTED_RE.search(prompt)
    if match:
        return match.group(1)
    match = DOC_MENTION_QUOTED_SINGLE_RE.search(prompt)
    if match:
        return match.group(1)
    match = DOC_MENTION_RE.search(prompt)
    if not match:
        return None
    candidate = match.group(1).rstrip('.,!?')
    if '.pdf' not in candidate.lower():
        return None
    return candidate


def find_document_mention(prompt: str, documents: list[Document]) -> Optional[Tuple[Document, str]]:
    if not prompt or '@' not in prompt:
        return None
    candidates: list[Tuple[int, int, Document, str]] = []
    for doc in documents:
        name = doc.original_name or doc.file_name
        if not name:
            continue
        markers = (f'@"{name}"', f"@'{name}'", f'@{name}')
        for marker in markers:
            start = prompt.find(marker)
            while start != -1:
                candidates.append((start, len(marker), doc, marker))
                start = prompt.find(marker, start + len(marker))
    if not candidates:
        return None
    # Pick earliest match; if same position, prefer longer marker
    candidates.sort(key=lambda item: (item[0], -item[1]))
    _, _, doc, marker = candidates[0]
    return doc, marker


def strip_doc_marker(prompt: str, marker: str) -> str:
    if not prompt or not marker:
        return prompt
    cleaned = prompt.replace(marker, "", 1)
    cleaned = re.sub(r'\s{2,}', ' ', cleaned)
    return cleaned.strip()


@shared_task(bind=True, max_retries=2)
def task_chat(self, job_id: int, prompt: str, model: str, system_prompt: Optional[str] = None):
    job = Job.objects.get(pk=job_id)
    job.status = 'running'
    job.save(update_fields=['status', 'updated_at'])
    try:
        base_system_prompt = prepend_model_rule(system_prompt, model) or "You are a helpful AI assistant."
        # Include last few turns so follow-ups like "그 다음역은?" have context
        recent = list(job.session.messages.order_by("-created_at")[:6])
        recent.reverse()
        recent_conversation = "\n".join(
            f"{m.role.capitalize()}: {m.content}" for m in recent if (m.role and m.content)
        )
        # 1) 세션에 업로드된 문서(RAG) 우선 처리
        documents = list(Document.objects.filter(session=job.session).order_by('-created_at'))
        doc_hit = find_document_mention(prompt, documents)
        doc_name = None
        doc = None
        marker = None
        if doc_hit:
            doc, marker = doc_hit
            doc_name = doc.original_name or doc.file_name
        else:
            doc_name = _fallback_extract_doc_name(prompt)
        citations = []
        if doc_name and doc is None:
            # If user attempted @mention but no matching document found.
            reply = f"'{doc_name}' 문서를 찾을 수 없습니다. 업로드한 파일명을 확인해주세요."
            with transaction.atomic():
                msg = Message.objects.create(session=job.session, role='assistant', content=reply, citations=[])
                job.message = msg
                job.status = 'success'
                job.error_message = ''
                job.save(update_fields=['message_id', 'status', 'error_message', 'updated_at'])
            return {'message_id': msg.id, 'content': reply}

        if doc:
            if doc.status != Document.STATUS_COMPLETED:
                reply = f"'{doc.original_name or doc_name}' 문서 처리 중입니다. 잠시 후 다시 시도해주세요."
                with transaction.atomic():
                    msg = Message.objects.create(session=job.session, role='assistant', content=reply, citations=[])
                    job.message = msg
                    job.status = 'success'
                    job.error_message = ''
                    job.save(update_fields=['message_id', 'status', 'error_message', 'updated_at'])
                return {'message_id': msg.id, 'content': reply}

            prompt_for_model = strip_doc_marker(prompt, marker) if marker else prompt
            if not prompt_for_model:
                prompt_for_model = prompt

            memories = memory_service.search_memory(
                [job.session.id],
                prompt_for_model,
                limit=6,
                document_id=doc.id
            )

            context_lines = []
            for idx, m in enumerate(memories, start=1):
                meta = m.metadata or {}
                page = meta.get('page')
                text = m.content.strip().replace("\n", " ")
                if len(text) > 400:
                    text = text[:400] + "..."
                context_lines.append(f"[{idx}] (p.{page}) {text}")

                citations.append({
                    'document_id': doc.id,
                    'document_name': doc.original_name or doc.file_name,
                    'page': page,
                    'bbox': meta.get('bbox', []),
                    'bbox_norm': meta.get('bbox_norm', []),
                    'page_width': meta.get('page_width'),
                    'page_height': meta.get('page_height'),
                    'snippet': text,
                })

            doc_context = "\n".join(context_lines) if context_lines else "관련 내용을 찾지 못했습니다."
            doc_rules = (
                "## Document Grounding Rules\n"
                "- You must answer using ONLY the provided document context.\n"
                "- If the answer is not present, say you cannot find it in the document.\n"
                "- Answer in Korean.\n"
            )
            recent_section = ""
            if recent_conversation.strip():
                recent_section = "## Recent conversation\n" + recent_conversation.strip() + "\n\n"
            enhanced_system_prompt = (
                f"{base_system_prompt}\n\n"
                f"{recent_section}"
                f"## Document Context: {doc.original_name or doc.file_name}\n"
                f"{doc_context}\n\n"
                f"{doc_rules}"
            )
            reply = run_chat(prompt_for_model, model=model, system_prompt=enhanced_system_prompt)
        else:
            # 2) 일반 채팅: 검색 필요성 평가 → Gemini 검색(선택) → RAG 컨텍스트와 함께 모델 호출
            retrieval_score = get_retrieval_score(prompt, model=model)
            use_gemini_search = retrieval_score >= 0.3
            job.result = {'retrieval_score': retrieval_score, 'use_gemini_search': use_gemini_search}
            logger.info(
                "task_chat retrieval job_id=%s retrieval_score=%.2f use_gemini_search=%s",
                job_id, retrieval_score, use_gemini_search,
            )

            external_context = ""
            if use_gemini_search:
                external_context = get_web_search_context(prompt, num=10)
                if not external_context:
                    logger.warning(
                        "task_chat job_id=%s: use_gemini_search=True but external_context empty. "
                        "Vertex AI: GOOGLE_CLOUD_PROJECT, GOOGLE_CLOUD_LOCATION, GOOGLE_GENAI_USE_VERTEXAI, GOOGLE_APPLICATION_CREDENTIALS. "
                        "Or Custom Search: GOOGLE_CUSTOM_SEARCH_API_KEY, GOOGLE_CSE_CX.",
                        job_id,
                    )

            job.result["external_context_used"] = bool(external_context)

            enhanced_system_prompt = get_rag_enhanced_system_prompt(
                job.session.id,
                prompt,
                base_system_prompt,
                recent_conversation=recent_conversation,
                exclude_sources=['pdf'],
            )

            if external_context:
                enhanced_system_prompt = (
                    f"{enhanced_system_prompt}\n\n"
                    "## External up-to-date information\n"
                    f"{external_context}\n\n"
                    "Use the above external information as the primary source for time-sensitive facts "
                    "or events after your knowledge cutoff. If you used this information in your answer, "
                    "say so (e.g. '검색 결과 기준', '실시간 검색 반영') and do NOT state a knowledge cutoff date "
                    "(e.g. do not say '2024년 6월 기준'). If the external info does not contain the answer, "
                    "you may fall back to your internal knowledge but clearly indicate any uncertainty."
                )

            reply = run_chat(prompt, model=model, system_prompt=enhanced_system_prompt)
        with transaction.atomic():
            msg = Message.objects.create(session=job.session, role='assistant', content=reply, citations=citations)
            job.message = msg
            job.status = 'success'
            job.error_message = ''
            update_fields = ['message_id', 'status', 'error_message', 'updated_at']
            if job.result and 'retrieval_score' in job.result:
                update_fields.append('result')
            job.save(update_fields=update_fields)

        # Index assistant response in RAG
        # Optimal point: After transaction commit to ensure data consistency
        memory_service.add_memory(
            job.session.id,
            reply,
            metadata={'role': 'assistant', 'message_id': msg.id, 'model': model}
        )

        return {'message_id': msg.id, 'content': reply}
    except AIError as e:
        job.status = 'failure'
        job.error_message = str(e)
        job.save(update_fields=['status', 'error_message', 'updated_at'])
        raise
    except Exception as e:
        job.status = 'failure'
        job.error_message = str(e)
        job.save(update_fields=['status', 'error_message', 'updated_at'])
        raise


@shared_task(bind=True, max_retries=2)
def task_image(
    self,
    job_id: int,
    prompt: str,
    model: str,
    base_prompt: str = None,
    aspect_ratio: str = '1:1',
    num_images: int = 1,
    seed: int = None,
    reference_image_id: int = None,
    reference_image_url: str = None,
    reference_image_urls: list = None,
    image_urls: list[str] = None,
    mask_url: str = None,
    resolution: str = None,
    output_format: str = None,
):
    job = Job.objects.get(pk=job_id)
    job.status = 'running'
    job.save(update_fields=['status', 'updated_at'])

    ref_url = reference_image_url
    ref_image = None
    session_ref_list = [u for u in (reference_image_urls or []) if u][:2]

    if session_ref_list:
        # 세션 참고 이미지(1~2개)만 사용: 요청 첨부는 참조로 섞지 않음
        has_reference = True
        has_attachments = False
        attachments = []
        if len(session_ref_list) == 1:
            ref_url = session_ref_list[0]
            edit_image_urls = None  # 단일은 ref_url로 전달
        else:
            ref_url = None
            edit_image_urls = session_ref_list[:2]
    else:
        if ref_url is None and reference_image_id:
            try:
                ref_image = ImageRecord.objects.get(pk=reference_image_id)
                ref_url = ref_image.image_url
            except ImageRecord.DoesNotExist:
                pass
        attachments = [u for u in (image_urls or []) if u]
        has_reference = ref_url is not None
        has_attachments = len(attachments) > 0
        edit_image_urls = None

    effective_model = model
    if model == IMAGE_MODEL_NANO_BANANA and not session_ref_list:
        if has_reference or has_attachments:
            effective_model = IMAGE_MODEL_NANO_BANANA_EDIT
            edit_image_urls = []
            if has_reference:
                edit_image_urls.append(ref_url)
            edit_image_urls.extend(attachments)
            edit_image_urls = edit_image_urls[:2]
        else:
            effective_model = IMAGE_MODEL_GEMINI3_PRO_IMAGE
    elif model == IMAGE_MODEL_NANO_BANANA and session_ref_list:
        effective_model = IMAGE_MODEL_NANO_BANANA_EDIT
        if edit_image_urls is None:
            edit_image_urls = [ref_url] if ref_url else session_ref_list[:2]
    elif model == IMAGE_MODEL_NANO_BANANA_2:
        if has_reference or has_attachments or session_ref_list:
            effective_model = IMAGE_MODEL_NANO_BANANA_2_EDIT
            if edit_image_urls is None:
                edit_image_urls = []
                if session_ref_list:
                    edit_image_urls.extend(session_ref_list[:2])
                else:
                    if has_reference and ref_url:
                        edit_image_urls.append(ref_url)
                    edit_image_urls.extend(attachments)
                edit_image_urls = [u for u in edit_image_urls if u][:14]
        else:
            effective_model = IMAGE_MODEL_NANO_BANANA_2

    # 사용자 입력으로 들어온 참조/첨부 이미지를 타임라인에 다시 보여주기 위한 메타데이터
    # (모델별 내부 fallback로 변형되기 전의 원본 입력 기준)
    input_reference_urls = session_ref_list[:2] if session_ref_list else ([ref_url] if ref_url else [])
    input_attachment_urls = [u for u in attachments if u]
    input_image_urls = []
    for u in [*input_reference_urls, *input_attachment_urls]:
        if u and u not in input_image_urls:
            input_image_urls.append(u)

    if effective_model == IMAGE_MODEL_KLING:
        if not has_reference and attachments:
            ref_url = attachments[0]
        elif session_ref_list and ref_url is None and edit_image_urls:
            ref_url = edit_image_urls[0]

    try:
        base_text = (base_prompt or '').strip()
        prompt_text = (prompt or '').strip()
        if base_text and prompt_text and prompt_text != base_text:
            effective_prompt = (
                f"{base_text}\n\n"
                f"Edit instruction: {prompt_text}\n\n"
                "Preserve the current subject identity, environment, outfit logic, and overall visual style unless the edit instruction explicitly changes them."
            )
            if input_reference_urls or input_attachment_urls:
                effective_prompt += "\nUse the provided reference image(s) as a strong guide for pose, limb placement, and composition."
        else:
            effective_prompt = prompt_text or base_text

        rag_context = get_rag_context_string(job.session.id, effective_prompt)
        effective_prompt = f"{rag_context}\n\nRequest: {effective_prompt}" if rag_context else effective_prompt
        images = run_image(
            effective_prompt,
            model=effective_model,
            aspect_ratio=aspect_ratio,
            num_images=num_images,
            seed=seed,
            reference_image_url=ref_url,
            mask_url=mask_url,
            resolution=resolution,
            output_format=output_format,
            **({'image_urls': edit_image_urls} if edit_image_urls else {}),
        )

        if not images:
            raise AIError('No image URL returned')

        with transaction.atomic():
            for img in images:
                url = img.get('url')
                img_seed = img.get('seed')
                if url:
                    rec = ImageRecord.objects.create(
                        session=job.session,
                        prompt=prompt,
                        image_url=url,
                        model=effective_model,
                        seed=img_seed or seed,
                        mask_url=mask_url,
                        reference_image=ref_image,
                        metadata={
                            'aspect_ratio': aspect_ratio,
                            'resolution': resolution,
                            'output_format': output_format,
                            'num_images': num_images,
                            'requested_model': model,
                            'effective_model': effective_model,
                            'input_reference_urls': input_reference_urls,
                            'input_attachment_urls': input_attachment_urls,
                            'input_image_urls': input_image_urls,
                        }
                    )
                    job.image_record = rec
                    break  # Only link one for now

            if job.image_record is None:
                raise AIError('No image URL in response (malformed fal response)')

            # Leave a lightweight assistant message so follow-up text chat can reference
            # the image generation context (single chat-room UX).
            rec = job.image_record
            summary = "\n".join(
                line
                for line in [
                    f"이미지 생성 완료 (ID: {rec.id})",
                    f"- 모델: {effective_model}",
                    (f"- seed: {rec.seed}" if rec.seed is not None else ""),
                    f"- 프롬프트: {_clip_text(prompt, 240)}",
                    f"- 이미지 URL: {rec.image_url}",
                ]
                if line
            )
            Message.objects.create(session=job.session, role='assistant', content=summary, citations=[])

            job.status = 'success'
            job.error_message = ''
            job.save(update_fields=['image_record_id', 'status', 'error_message', 'updated_at'])

        # Index generated image in RAG
        # Optimal point: After transaction, ensures ImageRecord exists
        if job.image_record:
            memory_service.add_memory(
                job.session.id,
                f"Generated image with prompt: {prompt}",
                metadata={
                    'type': 'image_generation',
                    'image_record_id': job.image_record.id,
                    'image_url': job.image_record.image_url,
                    'model': effective_model
                }
            )

        return {'image_record_id': job.image_record_id, 'url': job.image_record.image_url}
    except AIError as e:
        job.status = 'failure'
        job.error_message = str(e)
        job.save(update_fields=['status', 'error_message', 'updated_at'])
        raise
    except Exception as e:
        job.status = 'failure'
        job.error_message = str(e)
        job.save(update_fields=['status', 'error_message', 'updated_at'])
        raise
