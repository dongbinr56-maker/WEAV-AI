# WEAV AI Jobs 앱 시리얼라이저
# Job 및 Artifact 모델을 JSON으로 변환

from rest_framework import serializers
from .models import Job, Artifact


class ArtifactSerializer(serializers.ModelSerializer):
    """
    Artifact 모델 시리얼라이저

    작업 결과 파일 정보를 JSON으로 변환
    """

    class Meta:
        model = Artifact
        fields = [
            'id', 'created_at', 'kind', 's3_key',
            'mime_type', 'size_bytes', 'presigned_url'
        ]
        read_only_fields = ['id', 'created_at', 's3_key', 'mime_type', 'size_bytes']


class JobCreateSerializer(serializers.ModelSerializer):
    """
    Job 생성용 시리얼라이저

    새 작업을 생성할 때 사용하는 입력 데이터 검증
    """

    class Meta:
        model = Job
        fields = [
            'provider', 'model_id', 'arguments', 'store_result'
        ]

    def validate_provider(self, value):
        """지원하는 제공자인지 검증"""
        supported_providers = ['openai', 'gemini']  # FAL.ai 제외
        if value not in supported_providers:
            raise serializers.ValidationError(f"지원하지 않는 제공자입니다: {value}. 지원: {supported_providers}")
        return value

    def validate_model_id(self, value):
        """유효한 모델 ID인지 기본 검증"""
        if not value or len(value.strip()) == 0:
            raise serializers.ValidationError("model_id는 필수입니다")
        return value.strip()

    def validate_arguments(self, value):
        """arguments가 유효한 JSON인지 검증"""
        if not isinstance(value, dict):
            raise serializers.ValidationError("arguments는 JSON 객체여야 합니다")
        return value


class JobDetailSerializer(serializers.ModelSerializer):
    """
    Job 상세 정보 시리얼라이저

    작업의 모든 정보를 포함한 읽기용 시리얼라이저
    """

    artifacts = ArtifactSerializer(many=True, read_only=True)
    duration = serializers.SerializerMethodField()

    class Meta:
        model = Job
        fields = [
            'id', 'created_at', 'updated_at', 'status', 'provider',
            'model_id', 'arguments', 'store_result', 'artifacts',
            'error', 'duration'
        ]
        read_only_fields = [
            'id', 'created_at', 'updated_at', 'status', 'artifacts', 'error', 'duration'
        ]

    def get_duration(self, obj):
        """작업 소요 시간 계산"""
        return obj.duration


class JobListSerializer(serializers.ModelSerializer):
    """
    Job 목록용 시리얼라이저

    목록 표시용으로 간단한 정보만 포함
    """

    artifact_count = serializers.SerializerMethodField()

    class Meta:
        model = Job
        fields = [
            'id', 'created_at', 'status', 'provider',
            'model_id', 'artifact_count'
        ]

    def get_artifact_count(self, obj):
        """생성된 아티팩트 수"""
        return obj.artifacts.count()