#!/bin/bash

# WEAV AI 백엔드 엔트리포인트 스크립트
# Docker 컨테이너 시작 시 실행되는 초기화 작업

set -e  # 에러 발생 시 스크립트 중단

echo "🚀 WEAV AI 백엔드 시작..."

# ===== 데이터베이스 연결 대기 =====
echo "⏳ 데이터베이스 연결 대기 중..."
while ! nc -z $POSTGRES_HOST $POSTGRES_PORT; do
    echo "   PostgreSQL이 준비되지 않음, 2초 후 재시도..."
    sleep 2
done
echo "✅ 데이터베이스 연결 성공"

# ===== 데이터베이스 마이그레이션 =====
echo "📦 데이터베이스 마이그레이션 실행..."
python manage.py migrate --noinput
echo "✅ 데이터베이스 마이그레이션 완료"

# ===== 정적 파일 수집 =====
echo "📄 정적 파일 수집..."
python manage.py collectstatic --noinput --clear
echo "✅ 정적 파일 수집 완료"

# ===== MinIO 버킷 생성 (선택사항) =====
if [ "$CREATE_BUCKET_ON_STARTUP" = "true" ]; then
    echo "📦 MinIO 버킷 확인/생성..."
    python -c "
import os
import sys
sys.path.insert(0, '/app')
from apps.storage.s3 import S3Storage
try:
    storage = S3Storage()
    storage.create_bucket_if_not_exists()
    print('✅ MinIO 버킷 준비 완료')
except Exception as e:
    print(f'⚠️  MinIO 버킷 생성 실패 (무시): {e}')
"
fi

# ===== Gunicorn으로 Django 실행 =====
echo "🌟 Gunicorn 서버 시작..."

# Gunicorn 설정
WORKERS=${GUNICORN_WORKERS:-4}
THREADS=${GUNICORN_THREADS:-2}
BIND=${GUNICORN_BIND:-0.0.0.0:8000}
TIMEOUT=${GUNICORN_TIMEOUT:-300}

echo "   워커: $WORKERS, 스레드: $THREADS"
echo "   바인드: $BIND, 타임아웃: ${TIMEOUT}초"

# Gunicorn 실행
exec gunicorn \
    --workers $WORKERS \
    --threads $THREADS \
    --bind $BIND \
    --timeout $TIMEOUT \
    --access-logfile - \
    --error-logfile - \
    --log-level info \
    --reload \
    weavai.wsgi:application