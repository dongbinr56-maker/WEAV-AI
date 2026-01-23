# WEAV AI 백엔드 인프라

Mac Mini + 외장하드 기반 프로덕션급 AI 생성 서비스 백엔드입니다.

## 🏗️ 아키텍처 개요

- **Nginx**: 리버스 프록시 및 로드 밸런서
- **Django + DRF**: API 서버 및 비즈니스 로직
- **PostgreSQL**: 영속 데이터 저장소
- **Redis**: Celery 브로커 및 캐시
- **Celery**: 비동기 작업 처리 (FAL.ai Queue)
- **MinIO**: S3 호환 파일 스토리지 (외장하드)

## 🚀 빠른 시작

### 1. 사전 준비

#### 외장하드 설정
```bash
# 외장하드 마운트 (예: /Volumes/WEAVAI_2T)
# MinIO 데이터가 저장될 디렉토리 생성
sudo mkdir -p /Volumes/WEAVAI_2T/minio-data

# 현재 사용자에게 디렉토리 소유권 부여
# $(whoami)는 현재 로그인한 사용자명을 의미
sudo chown -R $(whoami) /Volumes/WEAVAI_2T/minio-data
```

#### 환경변수 설정
```bash
# infra/.env 파일 생성 및 설정
cp infra/.env.example infra/.env

# 필수 값들 설정 (vim/nano로 편집)
vim infra/.env
```

**중요한 설정들:**
```bash
# MinIO 데이터 경로 (외장하드 경로로 변경)
MINIO_DATA_DIR=/Volumes/WEAVAI_2T/minio-data

# MinIO 보안 설정 (랜덤한 긴 문자열로 변경)
MINIO_ACCESS_KEY=weavai_admin
MINIO_SECRET_KEY=your-very-long-random-secret-key-at-least-32-characters

# 데이터베이스 설정
POSTGRES_PASSWORD=your-secure-database-password

# FAL.ai API 키 (https://fal.ai에서 발급받기)
FAL_KEY=your-fal-ai-api-key

# Django 시크릿 키 (랜덤 문자열)
SECRET_KEY=your-super-secret-key-change-this-immediately
```

### 2. Docker Compose 실행

```bash
# infra 디렉토리로 이동
cd infra

# 환경변수 로드
set -a && source .env && set +a

# 서비스 시작 (빌드 포함)
docker compose up -d --build

# 로그 확인
docker compose logs -f
```

### 3. 초기 설정 확인

```bash
# Nginx 헬스체크
curl http://localhost:8080/healthz
# 응답: "ok"

# API 헬스체크
curl http://localhost:8080/api/v1/health/
# 응답: {"status": "healthy", "services": {...}}
```

### 4. MinIO 버킷 초기화 (선택사항)

```bash
# MinIO 클라이언트 설치 (macOS)
brew install minio/stable/mc

# 버킷 생성 및 정책 설정
./scripts/init_minio_bucket.sh
```

## 🔧 Cloudflare Tunnel 연결

### 1. Cloudflare 계정 준비
```bash
# Cloudflare CLI 설치
brew install cloudflared

# Cloudflare 로그인
cloudflared tunnel login
```

### 2. 터널 생성 및 설정
```bash
# weavai.ai 도메인을 위한 터널 생성
cloudflared tunnel create weavai

# config 파일 생성 (~/.cloudflared/config.yml)
cat > ~/.cloudflared/config.yml << EOF
tunnel: weavai
credentials-file: ~/.cloudflared/weavai.json

ingress:
  - hostname: weavai.ai
    service: http://localhost:8080
  - hostname: api.weavai.ai
    service: http://localhost:8080
  - service: http_status:404
EOF
```

### 3. DNS 레코드 설정

#### 방법 1: Cloudflare 대시보드
1. Cloudflare 대시보드 → weavai.ai 도메인 선택
2. **DNS** → **Records** → **Add record**
   - Type: `CNAME`
   - Name: `weavai.ai` (또는 `@`)
   - Target: `<터널-ID>.cfargotunnel.com`
   - TTL: `Auto`
   - Proxy status: `Proxied`

#### 방법 2: CLI 명령어
```bash
# DNS 레코드 생성
cloudflared tunnel route dns weavai weavai.ai
cloudflared tunnel route dns weavai api.weavai.ai
```

### 4. 터널 실행
```bash
# 터널 시작 (백그라운드에서 실행)
cloudflared tunnel --config ~/.cloudflared/config.yml run weavai &

# 또는 서비스로 등록 (자동 시작)
sudo cloudflared service install
```

### 5. 연결 확인
```bash
# 외부에서 접근 확인
curl https://weavai.ai/healthz
curl https://api.weavai.ai/api/v1/health/
```

## 📊 서비스 상태 확인

### 개별 서비스 상태
```bash
# Docker 컨테이너 상태
docker compose ps

# 특정 서비스 로그
docker compose logs api
docker compose logs worker
docker compose logs minio

# MinIO 웹 콘솔 (브라우저)
# http://127.0.0.1:9001
# 사용자명: weavai_admin
# 비밀번호: [MINIO_SECRET_KEY 값]
```

### API 테스트
```bash
# AI 작업 생성 테스트
curl -X POST http://localhost:8080/api/v1/jobs/ \
  -H "Content-Type: application/json" \
  -d '{
    "provider": "fal",
    "model_id": "fal-ai/fast-sdxl",
    "arguments": {
      "prompt": "A beautiful sunset over mountains"
    },
    "store_result": true
  }'

# 작업 상태 조회 (ID는 위 응답에서 확인)
curl http://localhost:8080/api/v1/jobs/{job-id}/
```

## 🔧 유지보수 작업

### 로그 관리
```bash
# 모든 서비스 로그
docker compose logs

# 최근 100줄 로그
docker compose logs --tail=100

# 실시간 로그 모니터링
docker compose logs -f api
```

### 데이터베이스 관리
```bash
# Django 관리 명령어 실행
docker compose exec api python manage.py shell
docker compose exec api python manage.py dbshell

# 마이그레이션
docker compose exec api python manage.py makemigrations
docker compose exec api python manage.py migrate
```

### 백업 및 복구
```bash
# PostgreSQL 백업
docker compose exec postgres pg_dump -U weavai_user weavai > backup.sql

# MinIO 데이터 백업 (외장하드 전체 백업 권장)
# /Volumes/WEAVAI_2T/minio-data 디렉토리 백업
```

### 서비스 재시작
```bash
# 전체 재시작
docker compose restart

# 특정 서비스 재시작
docker compose restart api worker

# 코드 변경 시 재빌드
docker compose up -d --build api worker
```

## 🚨 문제 해결

### 일반적인 문제들

#### 1. MinIO 연결 실패
```bash
# MinIO 로그 확인
docker compose logs minio

# MinIO 컨테이너 재시작
docker compose restart minio
```

#### 2. 데이터베이스 연결 실패
```bash
# PostgreSQL 상태 확인
docker compose exec postgres pg_isready -U weavai_user -d weavai

# PostgreSQL 재시작
docker compose restart postgres
```

#### 3. Celery 작업이 처리되지 않음
```bash
# Worker 로그 확인
docker compose logs worker

# Redis 연결 확인
docker compose exec redis redis-cli ping
```

#### 4. 외장하드 마운트 문제
```bash
# 디스크 마운트 상태 확인
df -h | grep Volumes

# 권한 재설정
sudo chown -R $(whoami) /Volumes/WEAVAI_2T/minio-data
```

### 로그 레벨 변경
`infra/.env`에서 `LOG_LEVEL`을 `DEBUG`, `INFO`, `WARNING`, `ERROR`로 조정 후 재시작:
```bash
docker compose restart api worker
```

## 🔒 보안 고려사항

- **API 키 관리**: FAL_KEY 등 민감한 정보는 `.env` 파일에서만 관리
- **MinIO 접근**: 외부 공개하지 말고 127.0.0.1로만 바인딩
- **데이터베이스**: 강력한 비밀번호 사용, 외부 접근 차단
- **Django**: 프로덕션에서는 `DEBUG=False`, 강력한 `SECRET_KEY` 사용
- **외장하드**: 중요한 데이터이므로 정기 백업 필수

## 📈 모니터링

### 헬스체크 엔드포인트
- `GET /healthz`: Nginx 상태
- `GET /api/v1/health/`: 전체 시스템 상태

### 메트릭 수집 (향후 확장)
- Django Debug Toolbar (개발 환경)
- Celery 모니터링
- PostgreSQL 쿼리 모니터링

## 🔄 업데이트 및 배포

### 코드 업데이트
```bash
# Git pull
git pull origin main

# 서비스 재빌드 및 재시작
cd infra
docker compose up -d --build
```

### 데이터베이스 스키마 변경
```bash
# 마이그레이션 파일 생성
docker compose exec api python manage.py makemigrations

# 마이그레이션 적용
docker compose exec api python manage.py migrate
```

## 📞 지원

문제가 발생하면 다음 정보를 포함해서 이슈를 생성해주세요:
- Docker Compose 로그 (`docker compose logs`)
- 환경 설정 (`.env` 파일 내용, 민감 정보 제외)
- 시스템 사양 (Mac Mini 모델, 외장하드 용량 등)
- 재현 단계

---

**🎉 WEAV AI 백엔드 설정 완료!**

이제 `https://weavai.ai`에서 AI 생성 서비스를 사용할 수 있습니다.