#!/bin/bash

# WEAV AI MinIO 버킷 초기화 스크립트
# Docker Compose에서 MinIO가 시작된 후 실행

set -e  # 에러 발생 시 스크립트 중단

# 환경변수 확인
if [ -z "$MINIO_ACCESS_KEY" ]; then
    echo "❌ MINIO_ACCESS_KEY 환경변수가 설정되지 않았습니다."
    exit 1
fi

if [ -z "$MINIO_SECRET_KEY" ]; then
    echo "❌ MINIO_SECRET_KEY 환경변수가 설정되지 않았습니다."
    exit 1
fi

if [ -z "$MINIO_BUCKET" ]; then
    echo "❌ MINIO_BUCKET 환경변수가 설정되지 않았습니다."
    exit 1
fi

MINIO_ENDPOINT=${MINIO_ENDPOINT:-http://localhost:9000}
MAX_RETRIES=30
RETRY_INTERVAL=2

echo "🔄 MinIO 버킷 초기화 시작..."
echo "   엔드포인트: $MINIO_ENDPOINT"
echo "   버킷: $MINIO_BUCKET"

# MinIO가 준비될 때까지 대기
echo "⏳ MinIO 서비스 준비 대기 중..."
for i in $(seq 1 $MAX_RETRIES); do
    if curl -f "$MINIO_ENDPOINT/minio/health/live" &>/dev/null; then
        echo "✅ MinIO 서비스 준비 완료"
        break
    fi

    if [ $i -eq $MAX_RETRIES ]; then
        echo "❌ MinIO 서비스가 준비되지 않았습니다."
        exit 1
    fi

    echo "   재시도 $i/$MAX_RETRIES..."
    sleep $RETRY_INTERVAL
done

# mc 클라이언트 설치 확인 (없으면 설치)
if ! command -v mc &> /dev/null; then
    echo "📦 MinIO 클라이언트(mc) 설치 중..."
    # macOS용 설치
    if [[ "$OSTYPE" == "darwin"* ]]; then
        brew install minio/stable/mc
    else
        echo "❌ 지원하지 않는 OS입니다. 수동으로 mc를 설치해주세요."
        exit 1
    fi
fi

# MinIO 호스트 설정
echo "🔗 MinIO 호스트 설정 중..."
mc alias set weavai "$MINIO_ENDPOINT" "$MINIO_ACCESS_KEY" "$MINIO_SECRET_KEY"

# 버킷 존재 확인 및 생성
echo "📦 버킷 확인/생성 중..."
if mc ls weavai/"$MINIO_BUCKET" &>/dev/null; then
    echo "✅ 버킷 '$MINIO_BUCKET' 이미 존재합니다."
else
    echo "🆕 버킷 '$MINIO_BUCKET' 생성 중..."
    mc mb weavai/"$MINIO_BUCKET"
    echo "✅ 버킷 '$MINIO_BUCKET' 생성 완료"
fi

# 버킷 정책 설정 (퍼블릭 읽기 권한)
echo "🔒 버킷 정책 설정 중..."
mc policy set public weavai/"$MINIO_BUCKET"

# 버킷 정보 출력
echo "📊 버킷 정보:"
mc ls weavai/"$MINIO_BUCKET"

echo "🎉 MinIO 버킷 초기화 완료!"
echo "   웹 콘솔: http://localhost:9001"
echo "   API 엔드포인트: $MINIO_ENDPOINT"
echo "   버킷: $MINIO_BUCKET"