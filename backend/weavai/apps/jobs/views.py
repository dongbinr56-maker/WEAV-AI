# WEAV AI Jobs 앱 뷰
# FAL.ai 기반 비동기 작업 관리 API

import logging
from rest_framework import generics, status
from rest_framework.response import Response
from rest_framework.decorators import action
from rest_framework.viewsets import ReadOnlyModelViewSet
from django.shortcuts import get_object_or_404
from .models import Job
from .serializers import (
    JobCreateSerializer, JobDetailSerializer,
    JobListSerializer, ArtifactSerializer
)
# from .tasks import submit_fal_job  # FAL.ai 제외

logger = logging.getLogger(__name__)


class JobViewSet(ReadOnlyModelViewSet):
    """
    AI 작업 관리 API

    FAL.ai를 사용한 비동기 이미지/비디오 생성 작업을 관리합니다.
    """

    queryset = Job.objects.all().prefetch_related('artifacts')

    def get_serializer_class(self):
        """액션에 따라 다른 시리얼라이저 사용"""
        if self.action == 'list':
            return JobListSerializer
        return JobDetailSerializer

    def create(self, request):
        """새 작업 생성"""
        serializer = JobCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        # Job 객체 생성 (PENDING 상태)
        job = Job.objects.create(**serializer.validated_data)

        logger.info(f"새 AI 작업 생성됨: {job.id}")

        # AI 작업 제출 (FAL.ai 제외 - 추후 구현 예정)
        # submit_ai_job.delay(str(job.id))  # 추후 구현

        return Response({
            'id': str(job.id),
            'status': job.status
        }, status=status.HTTP_201_CREATED)

    def retrieve(self, request, pk=None):
        """작업 상세 조회"""
        job = get_object_or_404(self.get_queryset(), pk=pk)
        serializer = self.get_serializer(job)
        return Response(serializer.data)

    def list(self, request):
        """작업 목록 조회"""
        queryset = self.get_queryset()

        # 쿼리 파라미터로 필터링
        status_filter = request.query_params.get('status')
        if status_filter:
            queryset = queryset.filter(status=status_filter)

        provider_filter = request.query_params.get('provider')
        if provider_filter:
            queryset = queryset.filter(provider=provider_filter)

        page = self.paginate_queryset(queryset)
        if page is not None:
            serializer = self.get_serializer(page, many=True)
            return self.get_paginated_response(serializer.data)

        serializer = self.get_serializer(queryset, many=True)
        return Response(serializer.data)