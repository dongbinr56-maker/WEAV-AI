# WEAV AI

fal.ai(GPT·Gemini 채팅, Google Imagen·FLUX 이미지) 기반 **채팅·이미지 생성·WEAV Studio** 서비스.  
채팅/이미지/스튜디오 세션은 DB에 저장되며, 비동기(Celery)로 처리됩니다.

---

## 요구 사항

| 구분 | 내용 |
|------|------|
| **Docker** | [Docker Desktop](https://www.docker.com/products/docker-desktop/) (Mac / Windows 공통 권장) |
| **Node.js** | 18+ (프론트엔드만 로컬 실행할 때) |
| **API 키** | [fal.ai](https://fal.ai) → **FAL_KEY** (필수) |

**Mac / Linux**  
- 터미널에서 `make` 사용 가능 (이미 있음).

**Windows**  
- **PowerShell 5+** 또는 **CMD** 사용.
- PowerShell에서 스크립트 실행이 막혀 있으면 한 번만 실행:
  ```powershell
  Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned
  ```
- 이후 프로젝트 루트에서 `.\compose.ps1 help` 로 동작 확인.

---

## 팀원 가이드: Git에서 받은 후 사용법

저장소를 클론한 **팀원**이 Mac/Windows에서 처음 실행할 때 순서대로 따라하면 됩니다.

### 1단계: 저장소 클론 & 환경 변수 (한 번만)

```bash
# 저장소 클론 (예시)
git clone https://github.com/your-org/WEAV-AI.git
cd WEAV-AI

# 인프라용 환경 변수 파일 생성
# Mac/Linux:
cp infra/.env.example infra/.env

# Windows (PowerShell):
# Copy-Item infra\.env.example infra\.env

# infra/.env 를 열어 FAL_KEY= 본인_키 로 수정 (필수)
```

- **FAL_KEY**: [fal.ai](https://fal.ai) 대시보드에서 발급. 팀에서 공유받거나 본인 계정으로 발급.
- 선택 항목(`YOUTUBE_API_KEY`, `MINIO_PUBLIC_ENDPOINT` 등)은 `infra/.env.example` 주석 참고.

### 2단계: 백엔드 실행 (Docker)

**Mac / Linux (프로젝트 루트에서):**
```bash
make build
make up
```

**Windows – PowerShell (프로젝트 루트에서):**
```powershell
.\compose.ps1 build
.\compose.ps1 up
```

**Windows – CMD:**
```cmd
compose.cmd build
compose.cmd up
```

- Docker Desktop이 설치·실행 중이어야 합니다.
- 첫 빌드는 이미지 다운로드로 시간이 걸릴 수 있습니다.

### 3단계: 백엔드 동작 확인

- 브라우저에서 **http://localhost:8080/api/v1/health/** 접속.
- `{"status":"ok"}` 가 보이면 정상입니다. (Windows에서 curl 없으면 브라우저로만 확인해도 됩니다.)

### 4단계: 프론트엔드 실행 (로컬 UI)

**프로젝트 루트**에서:

```bash
cd frontend

# .env 없으면 한 번만 생성 (API 주소 설정)
cp .env.example .env
# Windows: Copy-Item .env.example .env

# 의존성 설치 (최초 1회 또는 package.json 변경 시)
npm install

# 개발 서버 실행
npm run dev
```

- 터미널에 나온 대로 **http://localhost:3001** 로 접속합니다. (기본 포트 3001)
- `/api` 요청은 자동으로 `http://localhost:8080`으로 프록시되므로, **백엔드를 먼저 띄운 뒤** 프론트를 실행하세요.

### 5단계: 매일 개발 시

1. **백엔드**: 프로젝트 루트에서 `make up` (Mac/Linux) 또는 `.\compose.ps1 up` (Windows) → 이미 떠 있으면 생략.
2. **프론트**: `cd frontend` → `npm run dev` → 브라우저에서 **http://localhost:3001** 접속.

중지: 백엔드는 `make down` / `.\compose.ps1 down`, 프론트는 터미널에서 `Ctrl+C`.

---

## 빠른 시작 (Mac / Windows 공통)

아래는 **프로젝트 루트** (`WEAV-AI` 폴더)에서 실행하는 기준입니다.

### 1. 저장소 클론 후 한 번만

```bash
# 1) 프로젝트 루트로 이동
cd WEAV-AI

# 2) 인프라 환경 변수 설정
#    infra/.env.example 을 복사해 infra/.env 생성 후 FAL_KEY 입력
```

**infra/.env 예시 (필수만)**

```env
FAL_KEY=your_fal_ai_key
```

선택: `YOUTUBE_API_KEY`, `MINIO_PUBLIC_ENDPOINT` 등은 `infra/.env.example` 참고.

### 2. Docker로 백엔드 기동

| 환경 | 명령 |
|------|------|
| **Mac / Linux** | `make build` → `make up` |
| **Windows (PowerShell)** | `.\compose.ps1 build` → `.\compose.ps1 up` |
| **Windows (CMD)** | `compose.cmd build` → `compose.cmd up` |

### 3. 기동 확인

- 브라우저: **http://localhost:8080/api/v1/health/** → `{"status":"ok"}` 이면 정상.
- Windows에서 `curl`이 없으면 브라우저로 위 주소만 열어보면 됩니다.

### 4. 프론트엔드 실행 (로컬에서 UI 띄우기)

API가 Docker로 8080에서 떠 있다고 가정합니다.

```bash
cd frontend
cp .env.example .env   # 없을 때만. 내용: VITE_API_BASE_URL=http://localhost:8080
npm install
npm run dev
```

- 브라우저에서 **http://localhost:3001** 접속 (기본 포트 3001, 사용 중이면 3002 등으로 안내됨).
- `/api` 요청은 Vite가 `http://localhost:8080`으로 프록시합니다.

---

## 환경별 명령 요약

**모든 명령은 프로젝트 루트에서 실행합니다.**

| 동작 | Mac / Linux | Windows (PowerShell) | Windows (CMD) |
|------|----------------|----------------------|---------------|
| 도움말 | `make help` | `.\compose.ps1 help` | `compose.cmd help` |
| 이미지 빌드 | `make build` | `.\compose.ps1 build` | `compose.cmd build` |
| 인프라 기동 | `make up` | `.\compose.ps1 up` | `compose.cmd up` |
| 인프라 중지 | `make down` | `.\compose.ps1 down` | `compose.cmd down` |
| 테스트 실행 | `make test` | `.\compose.ps1 test` | `compose.cmd test` |
| 마이그레이션 | `make migrate` | `.\compose.ps1 migrate` | `compose.cmd migrate` |
| API 로그 보기 | `make logs` | `.\compose.ps1 logs` | `compose.cmd logs` |
| API 컨테이너 셸 | `make shell` | `.\compose.ps1 shell` | `compose.cmd shell` |

직접 Docker Compose를 쓰고 싶다면:

```bash
cd infra
docker compose up -d
docker compose down
docker compose run --rm --entrypoint python api manage.py test tests
docker compose run --rm --entrypoint python api manage.py migrate
```

---

## 환경 변수 정리

### infra/.env (Docker 백엔드)

| 변수 | 설명 | 필수 |
|------|------|------|
| `FAL_KEY` | fal.ai API 키 | ✅ |
| `YOUTUBE_API_KEY` | YouTube Data API v3 (트렌드 시그널 등) | 선택 |
| `MINIO_PUBLIC_ENDPOINT` | fal이 이미지에 접근할 공개 MinIO 주소 (ngrok 등) | 선택 |
| `MINIO_BROWSER_ENDPOINT` | 프론트에서 업로드/첨부 이미지를 바로 표시할 MinIO 주소 (로컬 권장: `localhost:9000`) | 선택 |

- 저장소에는 `.env`가 없습니다. 팀원은 `infra/.env.example`을 복사해 `infra/.env`로 만들고, **FAL_KEY**만이라도 넣으면 Docker 빌드·기동·테스트 가능합니다.

### frontend/.env (프론트만 로컬 실행 시)

| 변수 | 설명 |
|------|------|
| `VITE_API_BASE_URL` | API 서버 주소. 기본: `http://localhost:8080` |

- `frontend/.env.example`을 복사해 `frontend/.env`로 두고 위 한 줄만 넣으면 됩니다.

---

## 테스트

- 로컬 Python 테스트 환경은 없습니다. 테스트는 **Docker 안에서만** 실행합니다.
- 인프라를 띄운 뒤, 프로젝트 루트에서:
  - **Mac/Linux:** `make test`
  - **Windows:** `.\compose.ps1 test` 또는 `compose.cmd test`
- 실패 시: `make up` / `.\compose.ps1 up` 으로 postgres·redis·api 기동 여부 확인 후, `make logs` / `.\compose.ps1 logs` 로 api 로그 확인.

### 테스트 DB 생성 오류(POSTGRES collation mismatch)

다음과 같은 에러로 테스트 DB 생성이 실패할 수 있습니다:

- `template database "template1" has a collation version mismatch`

Docker Postgres 데이터 볼륨이 다른 glibc 버전에서 만들어진 경우 발생합니다. 아래를 1회 실행하면 해결됩니다.

```bash
cd infra
docker compose exec -T postgres psql -U weavai -d postgres -c "ALTER DATABASE template1 REFRESH COLLATION VERSION;"
docker compose exec -T postgres psql -U weavai -d template1 -c "REINDEX DATABASE template1;"
docker compose exec -T postgres psql -U weavai -d postgres -c "ALTER DATABASE postgres REFRESH COLLATION VERSION;"
docker compose exec -T postgres psql -U weavai -d postgres -c "ALTER DATABASE weavai REFRESH COLLATION VERSION;"
```

---

## 서비스 사용 방법

1. **햄버거 메뉴(☰)**  
   - **새 채팅** / **새 이미지** / **WEAV Studio** 로 세션 생성  
   - 채팅·이미지·스튜디오 세션 목록에서 기존 세션 선택

2. **채팅**  
   - 모델 선택(Gemini 2.5 Flash/Pro, GPT-4o 등) 후 메시지 입력·전송  
   - 응답은 비동기 처리, 완료 시 자동 갱신  
   - 같은 채팅방에서 **텍스트↔이미지 모드 토글**로 이미지 생성까지 공존
   - (문서 RAG) 채팅방에서 PDF/HWP/HWPX 업로드 후 `@문서명`으로 질문하면, 답변 근거를 PDF 하이라이트로 확인 가능

3. **이미지 생성**  
   - 모델 선택(Imagen 4, FLUX Pro v1.1 Ultra, Nano Banana 등) 후 프롬프트 입력·생성  
   - 참조 이미지·첨부 이미지로 편집 가능  
   - 생성된 이미지는 세션별 목록에 표시

4. **WEAV Studio**  
   - 기획·주제 선정·대본 설계·이미지/대본 생성·AI 음성·영상·메타데이터 AI 생성·썸네일 연구소(유튜브 URL 벤치마킹)까지 한 플로우로 진행

---

## API 엔드포인트 (요약)

| 메서드 | 경로 | 설명 |
|--------|------|------|
| GET | `/api/v1/health/` | 헬스체크 |
| GET | `/api/v1/sessions/` | 세션 목록 (`?kind=chat` \| `?kind=image` \| `?kind=studio`) |
| POST | `/api/v1/sessions/` | 세션 생성 (`kind`, `title`) |
| GET | `/api/v1/sessions/:id/` | 세션 상세 |
| POST | `/api/v1/sessions/:id/upload/` | 문서 업로드(PDF/HWP/HWPX) 후 RAG 색인 (비동기) |
| GET | `/api/v1/sessions/:id/documents/` | 업로드 문서 목록/상태 |
| POST | `/api/v1/chat/complete/` | 채팅 전송 (비동기) |
| POST | `/api/v1/chat/image/` | 이미지 생성 (비동기, 참조/첨부 이미지 지원) |
| GET | `/api/v1/chat/job/:task_id/` | 비동기 작업 상태·결과 조회 |

---

## 프로젝트 구조 (진행 상황 기준)

| 경로 | 설명 |
|------|------|
| **backend/** | Django 4 + DRF, Celery, fal.ai 연동 |
| **backend/config/** | 설정(settings, urls, wsgi, celery) |
| **backend/apps/** | users, chats, core, ai (채팅·이미지·스튜디오 API) |
| **backend/jobs/** | PDF 처리 등 백그라운드 작업 |
| **backend/storage/** | S3/MinIO 업로드 (첨부·참조 이미지) |
| **backend/tests/** | 프로젝트 테스트 (Docker에서만 실행) |
| **frontend/** | React 19 + Vite 6 + TypeScript, Tailwind |
| **frontend/src/components/studio/** | WEAV Studio UI (기획·대본·음성·영상·메타·썸네일) |
| **infra/** | Docker Compose (postgres, redis, minio, api, worker, nginx) |
| **Makefile** | Docker 명령 래퍼 (Mac/Linux) |
| **compose.ps1 / compose.cmd** | Docker 명령 래퍼 (Windows) |
| **00_docs/** | 프로젝트 프레임워크·참고 문서 |

자세한 구성은 아래 문서를 참고하세요.

- [00_docs/프로젝트_프레임워크.md](00_docs/프로젝트_프레임워크.md): 기술 스택/디렉터리 구조 요약
- `00_docs/Win&Mac_QuickStart_GuideLine.md`: Docker 기준 “내리고-올리고-마이그레이션-접속”만 있는 빠른 가이드
- `00_docs/Learn_About_This_Project_E2E.pdf`: 3일 완주용 E2E 학습 문서(“내가 만든 것처럼” 설명/확장)
  - 원본: `00_docs/Learn_About_This_Project_E2E.md`
  - 비개발자용(7일): `00_docs/Learn_About_This_Project_E2E_Beginer.md`
  - PDF 재생성: `./.venv/bin/python 00_docs/_tools/build_learn_pdf.py`
