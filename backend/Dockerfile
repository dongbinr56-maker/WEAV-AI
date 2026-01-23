# WEAV AI Django 백엔드 Dockerfile
# 프로덕션용 Gunicorn + Django 설정

FROM python:3.12-slim

# 환경변수 설정
ENV PYTHONUNBUFFERED=1
ENV PYTHONDONTWRITEBYTECODE=1
ENV DJANGO_SETTINGS_MODULE=weavai.settings

# 시스템 패키지 설치
RUN apt-get update && apt-get install -y \
    gcc \
    postgresql-client \
    curl \
    netcat-openbsd \
    && rm -rf /var/lib/apt/lists/*

# 작업 디렉토리 설정
WORKDIR /app

# Python 패키지 설치
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# 애플리케이션 코드 복사
COPY . .

# 정적 파일 수집 (프로덕션용)
RUN python manage.py collectstatic --noinput

# 실행 권한 설정
RUN chmod +x entrypoint.sh

# 포트 노출
EXPOSE 8000

# 헬스체크
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD curl -f http://localhost:8000/api/v1/health/ || exit 1

# 엔트리포인트 실행
ENTRYPOINT ["./entrypoint.sh"]