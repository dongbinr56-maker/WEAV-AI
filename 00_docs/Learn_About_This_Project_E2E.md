# WEAV AI: 프로젝트 E2E 이해 가이드 (3일 완주)

이 문서는 현재 저장소 상태(코드 기준)에서 WEAV AI를 "내가 만든 것처럼" 설명하고 확장할 수 있도록 돕기 위한 학습용 문서입니다.

- 대상: 이 프로젝트를 인수/설명해야 하는 개발자(본인)
- 목표: 3일 동안 (1) 실행, (2) 구조 이해, (3) 핵심 로직 추적, (4) 변경/확장까지 가능
- 범위: 프론트, 백엔드, DB, 비동기, 스토리지, RAG(문서 검색), Studio(유튜브 워크플로우)

이 문서를 끝까지 따라가면 아래 질문에 "내가 설계한 것처럼" 답할 수 있어야 합니다.

- 이 프로젝트는 뭘 하는가? 사용자가 체감하는 기능은 무엇인가?
- 어떤 기술 스택을 쓰는가? 각 스택을 왜 선택했는가? 대체안과 트레이드오프는?
- DB는 어떻게 구성되어 있고 왜 이 DB인가?
- 비동기는 무엇이고, 이 프로젝트는 비동기를 위해 무엇(Celery/Redis)을 선택했는가?
- 문서 업로드 후 RAG는 어떻게 동작하며 citations(bbox/page)을 왜 저장하는가?
- 운영/배포 시 가장 먼저 터질 수 있는 포인트는 무엇이고, 어떤 체크리스트가 필요한가?

---

## 0. 한 줄 요약

WEAV AI는 **Django(REST) + Celery(비동기) + PostgreSQL(pgvector) + MinIO(S3 호환) + React(Vite)** 조합으로,

- 채팅(LLM)과 이미지 생성(fal.ai)을 비동기로 처리하고
- 문서(PDF/HWP/HWPX) 업로드 후 텍스트/이미지 OCR을 통해 **RAG(검색 기반 응답)** 를 제공하며
- 별도 UI인 **WEAV Studio(유튜브 기획/분석/이미지/TTS)** 워크플로우를 포함하는 서비스입니다.

---

## 0.1 3일 학습 커리큘럼(권장)

- Day 1: "실행 + 전체 아키텍처 + API 계약"을 눈으로 확인
- Day 2: "백엔드/DB/비동기/RAG"를 코드 레벨로 추적
- Day 3: "프론트/Studio"를 코드 레벨로 추적하고 확장 과제를 해보기

## 0.2 용어 사전(이 문서에서 쓰는 단어)

- Session: 사용자가 만드는 대화/이미지/스튜디오 프로젝트 단위(서버 DB에 저장)
- Job: 비동기 작업 단위(채팅 생성, 이미지 생성 등). task_id로 폴링
- RAG: Retrieval-Augmented Generation. "검색 결과(메모리)를 system prompt에 넣고 답변"
- Citation: 답변 근거. (문서명, page, bbox/bbox_norm) 정보를 프론트로 내려 PDF 하이라이트에 사용
- MinIO presigned URL: 객체를 다운로드할 수 있는 임시 URL. 브라우저/외부 AI가 접근 가능해야 함

---

## 1. 시스템 구성(큰 그림)

### 1.1 컴포넌트 맵

- 브라우저(사용자)
  - `frontend/` (React + Vite) UI
  - 문서 뷰어: `pdfjs-dist` 로 PDF 렌더링 + 인용(하이라이트) 표시
- Nginx(리버스 프록시)
  - `infra/nginx/conf.d/weavai.conf`
  - `http://localhost:8080` 에서 `/api/`, `/admin/`, `/static/`, `/media/` 라우팅
- Django API
  - `backend/` (Django 4.2 + DRF)
  - 채팅/이미지: `apps/ai`
  - 세션/문서: `apps/chats`
  - 스튜디오/유튜브: `apps/core`
- Celery Worker
  - 장시간 작업(LLM/이미지 생성/문서 처리)을 비동기로 실행
  - Redis가 broker/result backend
- PostgreSQL(+pgvector)
  - 관계형 데이터(세션/메시지/문서/작업) + 벡터 검색(ChatMemory.embedding)
- MinIO(S3 호환 오브젝트 스토리지)
  - 업로드 문서, 참조 이미지/첨부 이미지, PDF에서 추출한 이미지 저장
- 외부 AI
  - fal.ai HTTP API (OpenRouter router 포함) - 채팅, 이미지 생성, TTS 일부
  - Google AI Studio Gemini API - 유튜브 벤치마킹 분석(직접 YouTube URL 분석 + 폴백)

### 1.2 ASCII 아키텍처 다이어그램(요청 흐름)

```text
Browser (React/Vite)
  |  (HTTP)
  v
Nginx :8080  ------------------------------+
  | /api                                   |
  v                                        |
Django API (DRF)                           |
  | creates Job + returns 202(task_id)     |
  v                                        |
Redis (broker/result) --> Celery Worker ---+--> fal.ai / OpenRouter / Gemini API
  |
  +--> PostgreSQL (Sessions, Messages, Jobs, Documents, ChatMemory(pgvector))
  |
  +--> MinIO (documents, uploads, extracted images, presigned URLs)
```

---

## 1.3 "사용자 체감" 기능 지도(화면 기준)

사용자가 앱에서 실제로 하는 행동을 기능으로 재분류하면 다음입니다.

- 사이드바에서 세션 생성/선택/삭제
  - kind: chat / image / studio
- Chat 세션
  - 텍스트 메시지 전송(비동기)
  - 같은 세션에서 이미지 모드로 전환해 이미지 생성(비동기)
  - regenerate로 마지막 대화/이미지 재생성
  - 텍스트 프롬프트 조립기(short/precise/creative)로 프롬프트 초안 생성
  - 문서 업로드 -> 처리 완료 후 `@문서명` 질문 -> 근거 확인
- Image 세션
  - 프롬프트로 이미지 생성
  - 이미지 프롬프트 생성기(subject/style/composition/environment 기반)로 영문 프롬프트 생성
  - 참조 이미지 업로드/선택
  - 첨부 이미지 1-2개 업로드(모델에 따라 제한)
- Studio 세션(WEAV Studio)
  - 트렌딩 조회(YouTube API)
  - 유튜브 URL 입력 -> 컨텍스트 수집(제목/설명/자막/길이)
  - 벤치마킹 분석(Gemini YouTube URL 직접 분석 또는 메타데이터/자막 폴백)
  - 기획/대본/장면 생성(LLM)
  - 장면 이미지/장면별 이미지 프롬프트 생성(Image)
  - TTS 생성(ElevenLabs via fal)
  - 영상 export, 메타데이터 생성, 썸네일 벤치마킹/완성 미리보기

## 2. 기술 스택과 선택 이유

### 2.1 프론트엔드

- React 19 + TypeScript
  - 채팅 UI/스튜디오 UI를 빠르게 구성(컴포넌트 중심)
  - 타입으로 API 응답/상태 관리를 안전하게 유지
- Vite 6 (dev server)
  - 빠른 HMR과 단순한 설정(프록시 포함)
- Tailwind CSS
  - 빠른 UI 프로토타이핑/반복에 적합(바이브 코딩 학습 목적과 맞음)
- pdfjs-dist
  - 문서 RAG의 "근거"를 PDF 페이지에 하이라이트로 보여주기 위해 필요

버전 참고(코드 기준):

```text
frontend/package.json
- react: ^19.0.0
- vite: ^6.0.0
- typescript: ~5.6.0
```

대체안과 트레이드오프:

- Next.js(App Router)로 통합도 가능하지만, 현재는 "단순 SPA + 백엔드 분리"가 학습/속도 측면에서 유리합니다.
- 상태 관리 라이브러리(Zustand/Redux) 대신 Context를 쓰는 이유는 의존성과 학습 난이도를 최소화하기 위해서입니다.

핵심 파일:

- Vite 설정: `frontend/vite.config.ts` (기본 포트 3001, `/api` -> 8080 프록시)
- API 클라이언트: `frontend/src/services/api/apiClient.ts`
- 채팅 상태: `frontend/src/contexts/ChatContext.tsx`
- 문서 패널/PDF 렌더: `frontend/src/components/chat/DocumentPanel.tsx`
- 스튜디오: `frontend/src/components/studio/StudioView.tsx`

### 2.2 백엔드

- Django 4.2 + DRF
  - 인증/관리자/ORM/마이그레이션 등 기본기가 탄탄하고 빠르게 개발 가능
  - REST 엔드포인트 중심으로 프론트와 계약하기 쉬움
- Celery + Redis
  - LLM/이미지 생성/문서 처리처럼 느린 작업을 API 요청-응답과 분리
  - 작업 상태(Job) 폴링 기반 UX 구현이 단순
- PostgreSQL + pgvector
  - 관계형 데이터 + 벡터 검색을 한 DB에서 처리 가능
  - 문서/대화 임베딩을 저장하고 CosineDistance로 검색
- MinIO(S3 호환)
  - 로컬 개발에서 "S3 같은" 흐름을 재현(업로드/프리사인 URL)
  - 운영에서 AWS S3로 쉽게 교체 가능한 설계

문서 처리 스택(선택 이유):

- PyMuPDF(fitz): PDF 텍스트 추출과 bbox를 얻기 쉬움(근거 하이라이트에 bbox가 핵심)
- LibreOffice(soffice): HWP/HWPX -> PDF 변환용(컨테이너에 설치)
- OCR:
  - PDF 내부 이미지를 추출해 MinIO에 저장하고 fal(VLM)로 OCR 텍스트 추출
  - (옵션) pytesseract가 있으면 페이지 OCR도 병행(현재 requirements.txt에는 미포함)

버전/의존성 참고(코드 기준):

```text
backend/requirements.txt
- Django==4.2
- djangorestframework==3.14
- celery[redis]==5.3
- redis>=5.0
- psycopg2-binary
- pgvector
- boto3
- pymupdf
```

핵심 파일:

- Django 설정: `backend/config/settings.py`
- 라우팅: `backend/config/urls.py`
- Celery: `backend/config/celery.py`
- 채팅/이미지 API: `backend/apps/ai/views.py`, `backend/apps/ai/tasks.py`
- 문서 업로드/세션: `backend/apps/chats/views.py`, `backend/apps/chats/tasks.py`
- RAG/벡터검색: `backend/apps/chats/services.py`
- 스토리지(MinIO): `backend/storage/s3.py`

### 2.3 인프라(로컬)

- Docker Compose: `infra/docker-compose.yml`
  - `postgres`(pgvector 이미지), `redis`, `minio`, `api`, `worker`, `nginx`
- Nginx: `infra/nginx/conf.d/weavai.conf`
  - 단일 진입점(8080) 제공, 정적 파일/미디어도 서빙

선택 이유(학습/구현 관점):

- "로컬에서 한 번에 띄우기"가 핵심이라 Docker Compose가 가장 단순한 선택
- 서비스 경계(api/worker/db/redis/minio)를 눈으로 확인하며 학습하기 좋음

---

## 3. DB 구성(모델)과 선정 이유

### 3.1 왜 PostgreSQL인가

- RAG(벡터 검색) 때문에 `pgvector` 확장이 필요
- Django ORM으로 관계형 데이터(세션/메시지/문서/작업) 관리가 쉬움
- 운영 환경에서도 검증된 안정성

개발 편의:

- `DATABASE_URL` 이 없으면 SQLite로 폴백(`backend/config/settings.py`)
- 하지만 실제 Docker 실행은 PostgreSQL을 사용(`infra/docker-compose.yml`)

### 3.2 핵심 테이블(개념 모델)

아래는 `backend/apps/chats/models.py` 기준입니다.

- `User` (커스텀 유저, 현재는 기본 AbstractUser 확장)
- `Session`
  - kind: `chat` | `image` | `studio`
  - title: 사이드바 표시용
  - reference_image_urls: 이미지 세션의 기본 참조(0~2개). 여러 요청에 재사용 가능
- `Message`
  - session 1:N
  - role(user/assistant), content
  - citations(JSON): 문서 기반 답변의 근거(bbox/page) 리스트
- `Job`
  - 비동기 작업 단위(채팅/이미지)
  - task_id(Celery task id), status(pending/running/success/failure)
  - 결과 연결: message 또는 image_record
- `ImageRecord`
  - 이미지 생성 결과(프롬프트, url, model, seed 등)
- `Document`
  - 세션에 업로드된 문서(PDF/HWP/HWPX)
  - status(pending/processing/completed/failed)
  - file_name(키), pdf_file_name(HWP 변환 결과 키), file_url(프리사인 URL)
- `ChatMemory`
  - RAG용 텍스트 청크 저장 + 임베딩(VectorField 1536)
  - metadata(JSON): source(pdf/chat/image_ocr), document_id, filename, page, bbox, bbox_norm, image_url 등

### 3.3 관계(ASCII)

```text
User 1 --- N Session
Session 1 --- N Message
Session 1 --- N ImageRecord
Session 1 --- N Document
Session 1 --- N Job
Session 1 --- N ChatMemory
```

---

## 4. 비동기(Async)란 무엇이고, 이 프로젝트는 어떻게 구현했나

### 4.1 왜 비동기가 필요한가

- LLM 응답: 외부 API 호출 + 지연(수 초~수십 초)
- 이미지 생성: 더 긴 지연(모델/해상도에 따라 수십 초 이상)
- 문서 처리: PDF 파싱/변환/OCR/임베딩 생성 등 CPU/IO가 큼

즉, HTTP 요청을 "기다리게" 만들면 UX가 나빠지고 타임아웃 위험이 큽니다.

### 4.2 선택: Celery + Redis

동작 방식(요약):

1) API 요청이 들어오면 DB에 `Job`을 만들고 `Celery task`를 큐에 넣음  
2) API는 `202 Accepted` 로 `task_id`를 반환  
3) 프론트는 `/api/v1/chat/job/<task_id>/` 로 폴링해서 상태를 확인  
4) 성공 시 `Message` 또는 `ImageRecord`가 DB에 저장되고, job_status 응답으로 전달됨

핵심 코드:

- task enqueue: `backend/apps/ai/views.py` (`task_chat.delay(...)`, `task_image.delay(...)`)
- worker task: `backend/apps/ai/tasks.py`
- job status: `backend/apps/ai/views.py::job_status`
- Celery 설정: `backend/config/celery.py`, `backend/config/settings.py`

### 4.3 취소/중단

- `/api/v1/chat/job/<task_id>/cancel/` 에서 Celery revoke로 작업 종료 요청

---

## 5. 핵심 기능별 E2E 흐름

### 5.1 채팅(Chat) 흐름

1) 프론트: `chatApi.completeChat(sessionId, prompt, model)`  
2) 백엔드: `backend/apps/ai/views.py::complete_chat`
   - 사용자 메시지 `Message(role=user)` 저장
   - `Job(kind=chat)` 생성
   - Celery `task_chat(job.id, ...)` enqueue
3) 워커: `backend/apps/ai/tasks.py::task_chat`
   - 최근 대화 일부를 system prompt에 포함(후속 질문 대응)
   - 문서 멘션이 있으면 해당 문서 memory만 검색해서 citations 포함
   - 없으면 일반 RAG(최근 memory 검색)로 system prompt 강화(일부 source 제외 가능)
   - fal(OpenRouter router)로 chat_completion 호출
   - assistant 메시지 저장 + RAG 메모리(assistant 응답)도 임베딩 저장
4) 프론트: `jobStatus` 폴링 후 assistant message를 화면에 표시

### 5.2 이미지(Image) 흐름

1) 프론트에서 참조/첨부 이미지를 먼저 업로드(선택)
   - 참조 1개: `/api/v1/chat/image/upload-reference/`
   - 첨부 1~2개: `/api/v1/chat/image/upload-attachments/`
   - 업로드 결과는 MinIO presigned URL
2) 프론트: `chatApi.completeImage(...)`  
3) 백엔드: `backend/apps/ai/views.py::complete_image`
   - 모델별로 "첨부/참조 허용 규칙"을 검증
   - `Job(kind=image)` 생성 후 Celery enqueue
4) 워커: `backend/apps/ai/tasks.py::task_image`
   - 모델/입력 상태에 따라 실제 호출 모델을 결정(예: Nano Banana edit로 자동 전환)
   - 필요 시 RAG 컨텍스트를 이미지 프롬프트 앞에 붙임
   - 이미지 URL 반환 -> `ImageRecord` 저장

### 5.3 문서 업로드 + RAG 흐름

1) 프론트: 세션에서 파일 업로드 `/api/v1/sessions/<id>/upload/`
2) 백엔드: `backend/apps/chats/views.py::session_upload`
   - MinIO에 업로드
   - `Document(status=pending)` 저장
   - Celery `process_pdf_document(document_id)` enqueue
3) 워커: `backend/apps/chats/tasks.py::process_pdf_document`
   - (HWP/HWPX면) LibreOffice로 PDF 변환 후 MinIO에 변환본 업로드
   - PyMuPDF로 텍스트 블록 + bbox 추출
   - PDF 내 이미지 추출 -> MinIO 업로드 -> fal(VLM)로 OCR 텍스트 추출
   - (옵션) pytesseract가 있으면 OCR 추가 추출
   - 청크를 합치고(페이지 기준 merge) `ChatMemory`에 임베딩 저장
   - metadata에 `document_id`, `page`, `bbox`, `bbox_norm`, `image_url` 등을 저장
4) 사용: 채팅 프롬프트에 문서명을 `@`로 멘션
   - 예: `@"사업공고문.pdf"에서 모집 기간 알려줘`
   - 워커 `backend/apps/ai/tasks.py::task_chat`에서 문서 멘션을 찾아 해당 문서 memory만 검색
   - 답변에 citations(JSON)을 넣어 프론트에서 근거 확인 가능

### 5.3.1 RAG 검색 알고리즘(구현 디테일)

RAG 품질을 좌우하는 핵심은 "무엇을 검색하고, 어떻게 섞고, 어떻게 프롬프트에 넣는가"입니다.

- 임베딩 생성
  - `backend/apps/chats/services.py::ChatMemoryService.embed_text`
  - OpenAI SDK를 "fal OpenRouter 호환 엔드포인트"로 붙여 embeddings 생성
  - embedding 모델 기본값: `openai/text-embedding-3-small` (1536 dim)
  - `FAL_KEY`가 없으면 안전하게 0 벡터를 반환(개발/테스트용 폴백)
- 검색(혼합 검색)
  - `backend/apps/chats/services.py::ChatMemoryService.search_memory`
  - 1) keyword 기반 점수 검색(간단한 토큰화 + contains 스코어링)
  - 2) 벡터 검색(CosineDistance) 결과
  - 3) RRF(Reciprocal Rank Fusion)로 두 결과를 병합
  - 4) (옵션) LLM rerank를 켜서 상위 후보를 재정렬
- rerank 토글(환경 변수)
  - `RERANK_ENABLED=1`이면 rerank 시도
  - `RERANK_MODEL` 기본: `openai/gpt-4.1`
  - `RERANK_MAX_CANDIDATES`로 rerank 후보 수 제한
- 문서 RAG의 포인트
  - `document_id`로 memory를 필터링해서 "해당 문서에서만" 근거를 뽑음
  - `bbox_norm`을 저장해 프론트에서 페이지 크기와 무관하게 하이라이트 가능
  - 이미지 OCR 결과는 `image_url`을 함께 저장해 근거 확인 UX를 확장할 여지가 있음

### 5.4 WEAV Studio 흐름(요약)

특징:

- Studio는 "세션 목록"만 DB를 쓰고, 워크플로우 상태(기획/대본/장면 등)는 **브라우저 localStorage**에 저장합니다.
- 백엔드는 Studio 전용 API를 제공:
  - 유튜브 컨텍스트 수집(제목/설명/자막/길이)
  - Gemini 기반 YouTube URL 벤치마킹 분석(실패 시 메타데이터/자막 폴백)
  - Studio 리서치/LLM 호출, 이미지 생성, TTS 호출
  - 영상 export job, 썸네일 벤치마킹 job, 메타데이터 생성 보조

관련 엔드포인트:

- `GET /api/v1/studio/trending/`
- `GET /api/v1/studio/youtube-context/?url=...`
- `POST /api/v1/studio/youtube-benchmark-analyze/`
- `POST /api/v1/studio/research/`
- `POST /api/v1/studio/llm/`
- `POST /api/v1/studio/image/`
- `POST /api/v1/studio/video-prompt/`
- `POST /api/v1/studio/bg-remove/`
- `POST /api/v1/studio/tts/`
- `POST /api/v1/studio/video/`
- `POST /api/v1/studio/export/`
- `GET /api/v1/studio/export/job/<task_id>/`
- `POST /api/v1/studio/export/job/<task_id>/cancel/`
- `POST /api/v1/studio/thumbnail-benchmark/`
- `GET /api/v1/studio/thumbnail-benchmark/job/<task_id>/`

코드 포인트(내가 짚을 수 있어야 하는 파일):

- Studio UI: `frontend/src/components/studio/StudioView.tsx`
  - localStorage 키가 sessionId 기반으로 구성됨(서버 DB가 아니라 브라우저에 저장)
  - Step 5에서 "대본 및 이미지 프롬프트 생성", Step 7~10에서 export/meta/thumbnail/preview를 관리
- Chat UI: `frontend/src/components/chat/PromptOrchestratorPanel.tsx`, `frontend/src/components/chat/ImagePromptBuilderPanel.tsx`
  - 텍스트 프롬프트 조립기와 이미지 프롬프트 생성기가 우측 패널 형태로 제공됨
- Studio API(백엔드): `backend/apps/core/views.py`
  - `studio_youtube_context`: oEmbed/설명/자막/길이 수집
  - `studio_youtube_benchmark_analyze`: Gemini 분석(YouTube URL 직접 분석 -> 실패 시 메타데이터/자막 폴백), 40분 초과는 차단
  - `studio_research`, `studio_llm`: 리서치/기획/대본/메타 생성용 LLM
  - `studio_image`: fal 이미지 생성
  - `studio_tts`: fal ElevenLabs TTS (`backend/apps/ai/fal_client.py::tts_elevenlabs`)
  - `studio_export`, `studio_thumbnail_benchmark`: 비동기 export/썸네일 생성 작업 시작

---

## 6. API 엔드포인트 요약

### 6.1 Chat/Image (apps/ai)

- `POST /api/v1/chat/complete/`
- `POST /api/v1/chat/regenerate/`
- `POST /api/v1/chat/image/`
- `POST /api/v1/chat/image/regenerate/`
- `POST /api/v1/chat/image/upload-reference/`
- `POST /api/v1/chat/image/upload-attachments/`
- `GET  /api/v1/chat/job/<task_id>/`
- `POST /api/v1/chat/job/<task_id>/cancel/`

### 6.2 Sessions/Documents (apps/chats)

- `GET/POST /api/v1/sessions/`
- `GET/PATCH/DELETE /api/v1/sessions/<id>/`
- `GET /api/v1/sessions/<id>/messages/`
- `GET /api/v1/sessions/<id>/images/`
- `POST /api/v1/sessions/<id>/upload/` (PDF/HWP/HWPX)
- `GET /api/v1/sessions/<id>/documents/`
- `GET /api/v1/sessions/<id>/documents/<doc_id>/file/`
- `DELETE /api/v1/sessions/<id>/documents/<doc_id>/`

### 6.3 Core/Studio/Health (apps/core)

- `GET /api/v1/health/`
- `GET /api/v1/studio/trending/`
- `GET /api/v1/studio/youtube-context/`
- `POST /api/v1/studio/youtube-benchmark-analyze/`
- `POST /api/v1/studio/research/`
- `POST /api/v1/studio/llm/`
- `POST /api/v1/studio/image/`
- `POST /api/v1/studio/video-prompt/`
- `POST /api/v1/studio/bg-remove/`
- `POST /api/v1/studio/tts/`
- `POST /api/v1/studio/video/`
- `POST /api/v1/studio/export/`
- `GET /api/v1/studio/export/job/<task_id>/`
- `POST /api/v1/studio/export/job/<task_id>/cancel/`
- `POST /api/v1/studio/thumbnail-benchmark/`
- `GET /api/v1/studio/thumbnail-benchmark/job/<task_id>/`

---

## 7. 환경 변수(운영 포인트)

### 7.1 필수

- `FAL_KEY` (fal.ai)

### 7.2 조건부

- `DATABASE_URL` (PostgreSQL)
- `CELERY_BROKER_URL`, `CELERY_RESULT_BACKEND` (Redis)
- `GEMINI_API_KEY` 또는 `GOOGLE_API_KEY` (Studio YouTube URL 직접 영상 분석, 선택)
- `OPENROUTER_BENCHMARK_MODEL` (Studio YouTube 메타데이터/자막 기반 벤치마킹 분석 모델, 선택)
- `YOUTUBE_API_KEY` (Studio trending)

### 7.3 MinIO 관련(중요)

MinIO는 "내부 접근 주소"와 "브라우저가 열 수 있는 주소"가 다릅니다.

- `MINIO_ENDPOINT`: Django 컨테이너 내부에서 접근하는 주소(예: `minio:9000`)
- `MINIO_BROWSER_ENDPOINT`: 브라우저가 열 수 있는 주소(예: `localhost:9000`)
- `MINIO_PUBLIC_ENDPOINT`: 외부 AI(fal)가 접근할 수 있는 주소(운영에서는 공개 도메인 필요)

로컬에서 fal이 `localhost`에 접근할 수 없기 때문에,

- 이미지 URL이 private/local/ngrok이면 백엔드에서 Data URI로 변환해 fal에 전달하는 방어 로직이 존재합니다.
  - `backend/apps/ai/fal_client.py::_ensure_fal_reachable_image_url`

---

## 8. 3일 학습 플랜(권장)

### Day 1 - 실행/전체 구조/엔드포인트

- Docker로 백엔드 전체 기동
  - `make build`
  - `make up`
  - 헬스체크: `http://localhost:8080/api/v1/health/`
- 프론트 실행
  - `cd frontend && npm install && npm run dev`
  - `http://localhost:3001`
- 사용 시나리오 3개를 직접 실행
  - 채팅 1회 + 재생성(regenerate)
  - 이미지 생성 1회(모델 바꿔보기)
  - 문서 업로드 1개 후 `@문서명`으로 질문
- 이때 확인할 것
  - Job 상태가 `pending -> running -> success` 로 바뀌는지
  - Document status가 `pending -> processing -> completed` 로 바뀌는지

### Day 2 - 백엔드/DB/RAG/비동기

- 모델/DB를 코드로 설명하기(면접용)
  - `Session/Message/Job/Document/ChatMemory` 를 ERD처럼 설명
- Celery 작업 3개를 추적
  - `backend/apps/ai/tasks.py::task_chat`
  - `backend/apps/ai/tasks.py::task_image`
  - `backend/apps/chats/tasks.py::process_pdf_document`
- RAG 품질을 좌우하는 지점 이해
  - chunking 전략(페이지별 merge, overlap)
  - metadata에 bbox_norm을 저장하는 이유(프론트 하이라이트)
  - keyword + vector 혼합 검색 + (옵션) rerank

### Day 3 - 프론트/Studio/확장 포인트

- 프론트 상태 흐름 이해
  - `ChatContext`가 폴링/오류/취소/첨부 업로드를 어떻게 제어하는지
  - `DocumentPanel`이 citations로 어떻게 페이지 이동/하이라이트를 하는지
  - `PromptOrchestratorPanel` / `ImagePromptBuilderPanel`이 프롬프트 생성 UX를 어떻게 제공하는지
- Studio 워크플로우 이해
  - 왜 localStorage에 저장하는지(빠른 프로토타이핑)
  - 어떤 API를 언제 호출하는지(trending/context/benchmark/research/llm/image/tts/export/thumbnail)
- 확장 과제(연습)
  - (예) 채팅 모델 목록을 프론트/백엔드에서 일치시키기
  - (예) Document 멘션 UX 개선(자동완성)
  - (예) Job 폴링을 SSE/WebSocket으로 교체(설계만 해보기)

---

## 9. 알려진 제약/주의점(현재 코드 기준)

- `entrypoint.sh`의 DB 대기는 `sleep 5`로 단순 구현(실서비스라면 readiness 체크 필요)
- Studio 세션의 대부분 상태는 DB가 아니라 브라우저 localStorage에 있음(다른 기기/브라우저에서 이어서 작업 불가)
- 일부 모델 ID는 프론트/백엔드 간 불일치 가능(모델 추가/변경 시 양쪽 동기화 필요)

---

## 10. 참고: “내가 만들었다”처럼 설명할 때의 말하기 템플릿

- "이 프로젝트는 채팅/이미지 생성은 비동기(Celery)로 처리하고, 결과는 Job 테이블로 트래킹해 프론트에서 폴링합니다."
- "문서 업로드는 MinIO에 저장하고, 워커가 PDF를 파싱/변환/OCR해서 pgvector 기반 ChatMemory로 색인합니다."
- "문서 기반 질문은 프롬프트에서 @문서명을 감지해서 해당 문서의 memory만 검색하고, bbox를 citations로 내려줘서 프론트에서 PDF 하이라이트가 가능합니다."
