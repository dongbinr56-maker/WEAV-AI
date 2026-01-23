# WEAV AI Backend

Django REST Framework 기반의 AI 생성 서비스 백엔드입니다.

## 🏗️ 아키텍처 개요

```
Internet → Cloudflare Tunnel → Nginx → Django + DRF
                                      → PostgreSQL (데이터)
                                      → Redis (캐시/작업 큐)
                                      → Celery (비동기 작업)
                                      → MinIO (파일 저장)
```

## 🚀 빠른 시작

### 1. 환경 설정

```bash
# Python 가상환경 생성
python3 -m venv venv
source venv/bin/activate

# 의존성 설치
pip install -r requirements.txt
```

### 2. 환경 변수 설정 (.env 파일 생성)

```bash
# Django
SECRET_KEY=your-super-secret-key-change-this
DEBUG=True
ALLOWED_HOSTS=localhost,127.0.0.1

# 데이터베이스
DB_NAME=weav_ai
DB_USER=weav_user
DB_PASSWORD=your-password
DB_HOST=localhost
DB_PORT=5432

# Redis
REDIS_URL=redis://localhost:6379/0

# AI API 키들
OPENAI_API_KEY=sk-your-openai-key
GEMINI_API_KEY=your-gemini-key

# 파일 저장소 (MinIO)
AWS_ACCESS_KEY_ID=minio
AWS_SECRET_ACCESS_KEY=minio123
AWS_STORAGE_BUCKET_NAME=weav-ai-files
AWS_S3_ENDPOINT_URL=http://localhost:9000

# 결제 (Stripe)
STRIPE_PUBLIC_KEY=pk_test_...
STRIPE_SECRET_KEY=sk_test_...
```

### 3. 데이터베이스 설정

```bash
# PostgreSQL 설치 및 실행
createdb weav_ai
createuser weav_user --password
psql -c "GRANT ALL PRIVILEGES ON DATABASE weav_ai TO weav_user;"

# 마이그레이션 실행
python manage.py makemigrations
python manage.py migrate

# 슈퍼유저 생성
python manage.py createsuperuser
```

### 4. Redis 및 Celery 설정

```bash
# Redis 설치 (macOS)
brew install redis
brew services start redis

# Celery 워커 실행 (새 터미널)
celery -A weav_ai worker --loglevel=info

# Celery Beat 실행 (새 터미널)
celery -A weav_ai beat --loglevel=info --scheduler django_celery_beat.schedulers:DatabaseScheduler
```

### 5. MinIO 설정

```bash
# Docker로 MinIO 실행
docker run -d \
  --name minio \
  -p 9000:9000 \
  -p 9001:9001 \
  -e "MINIO_ROOT_USER=minio" \
  -e "MINIO_ROOT_PASSWORD=minio123" \
  minio/minio server /data --console-address ":9001"

# 브라우저에서 http://localhost:9001 접속
# weav-ai-files 버킷 생성
```

### 6. 서버 실행

```bash
# Django 서버 실행
python manage.py runserver

# 또는 Docker Compose로 전체 스택 실행
docker-compose up -d
```

## 📡 API 엔드포인트

### 인증
- `POST /api/auth/login/` - 로그인
- `POST /api/auth/register/` - 회원가입
- `POST /api/auth/token/refresh/` - 토큰 갱신

### AI 서비스
- `POST /api/ai/generate/image/` - 이미지 생성
- `POST /api/ai/generate/video/` - 비디오 생성
- `GET /api/ai/tasks/` - 작업 목록 조회
- `GET /api/ai/tasks/{id}/` - 작업 상태 조회

### 결제
- `POST /api/payments/create-subscription/` - 구독 생성
- `POST /api/payments/buy-credits/` - 크레딧 구매
- `GET /api/payments/history/` - 결제 내역

### 관리자
- `/admin/` - Django Admin 패널

## 🔧 개발 명령어

```bash
# 코드 린팅
npm run lint      # 프론트엔드
# Python 코드용으로는 flake8, black 설정 필요

# 테스트
python manage.py test

# 데이터베이스 관리
python manage.py makemigrations
python manage.py migrate
python manage.py dbshell

# 정적 파일
python manage.py collectstatic

# 캐시 비우기
python manage.py clear_cache
```

## 🐳 Docker 배포

```bash
# 전체 스택 실행
docker-compose up -d

# 로그 확인
docker-compose logs -f backend

# 컨테이너 재시작
docker-compose restart backend

# 전체 중지 및 정리
docker-compose down -v
```

## 🔒 보안 고려사항

- 환경 변수로 민감한 정보 관리
- HTTPS 적용 (Cloudflare Tunnel 권장)
- API 키 로테이션
- 사용자 권한 체계 구현
- 요청 제한 및 속도 제한

## 📊 모니터링

- Django Debug Toolbar (개발 시)
- Celery 모니터링: `flower` (선택사항)
- PostgreSQL 모니터링
- Redis 모니터링

## 🚀 프로덕션 배포

1. `DEBUG=False` 설정
2. 강력한 `SECRET_KEY` 사용
3. PostgreSQL, Redis, MinIO 프로덕션 설정
4. Nginx SSL 설정
5. 백업 시스템 구축
6. 모니터링 및 알림 설정

---

**문의**: 백엔드 설정 중 문제가 발생하면 이슈를 등록해주세요.