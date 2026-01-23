# WEAV AI Core 앱 뷰
# 기본 헬스체크 및 시스템 상태 확인

from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework import status
from django.conf import settings
from django.core.cache import cache
from django.db import connection


class HealthCheckView(APIView):
    """
    시스템 헬스체크 API

    GET /api/v1/health/
    - 서비스 상태 확인
    - 데이터베이스 연결 상태 확인
    - 캐시(Redis) 연결 상태 확인
    """

    # 인증 불필요 (모니터링용)
    permission_classes = []
    authentication_classes = []

    def get(self, request):
        """헬스체크 수행"""
        health_status = {
            'status': 'healthy',
            'timestamp': None,  # ISO 형식 타임스탬프
            'version': '1.0.0',  # API 버전
            'services': {}
        }

        # 데이터베이스 연결 확인
        try:
            with connection.cursor() as cursor:
                cursor.execute("SELECT 1")
            db_status = 'healthy'
        except Exception as e:
            db_status = f'unhealthy: {str(e)}'
            health_status['status'] = 'unhealthy'

        health_status['services']['database'] = db_status

        # Redis 캐시 연결 확인
        try:
            cache.set('health_check', 'ok', 10)
            cache_value = cache.get('health_check')
            if cache_value == 'ok':
                redis_status = 'healthy'
            else:
                redis_status = 'unhealthy: cache read failed'
                health_status['status'] = 'unhealthy'
        except Exception as e:
            redis_status = f'unhealthy: {str(e)}'
            health_status['status'] = 'unhealthy'

        health_status['services']['redis'] = redis_status

        # 기타 서비스 상태 추가 가능
        health_status['services']['django'] = 'healthy'
        health_status['services']['celery'] = 'unknown'  # 워커 상태 확인은 별도 구현 필요

        # 타임스탬프 추가
        from django.utils import timezone
        health_status['timestamp'] = timezone.now().isoformat()

        # 응답 상태 코드 결정
        response_status = status.HTTP_200_OK if health_status['status'] == 'healthy' else status.HTTP_503_SERVICE_UNAVAILABLE

        return Response(health_status, status=response_status)