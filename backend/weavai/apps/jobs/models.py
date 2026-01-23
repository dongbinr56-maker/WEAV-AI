# WEAV AI Jobs 앱 모델
# AI 작업 관리 (FAL.ai 제외 - 추후 확장 예정)

from django.db import models
from django.core.validators import MinValueValidator, MaxValueValidator
import uuid


class Job(models.Model):
    """
    AI 생성 작업 모델

    비동기 작업을 추적 (현재 FAL.ai 제외)
    """

    # 작업 상태 정의
    STATUS_CHOICES = [
        ('PENDING', '대기 중'),           # 작업 생성됨, 아직 제출되지 않음
        ('SUBMITTED', '제출됨'),          # AI 서비스에 작업 제출됨
        ('IN_QUEUE', '큐 대기 중'),       # 큐에서 대기 중
        ('IN_PROGRESS', '진행 중'),       # 처리 중
        ('COMPLETED', '완료됨'),          # 작업 성공적으로 완료됨
        ('FAILED', '실패함'),             # 작업 실패
    ]

    # 제공자 정의 (확장 가능) - FAL.ai 제외
    PROVIDER_CHOICES = [
        # ('fal', 'FAL.ai'),  # 추후 확장 예정
        ('openai', 'OpenAI'),
        ('gemini', 'Google Gemini'),
        # 향후 확장: ('replicate', 'Replicate')
    ]

    # 기본 필드
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    # 작업 정보
    status = models.CharField(
        max_length=20,
        choices=STATUS_CHOICES,
        default='PENDING',
        db_index=True
    )
    provider = models.CharField(
        max_length=20,
        choices=PROVIDER_CHOICES,
        default='openai'  # FAL.ai 제외로 OpenAI로 변경
    )
    model_id = models.CharField(
        max_length=100,
        help_text='AI 모델 ID (예: fal-ai/fast-sdxl)'
    )

    # 작업 파라미터 (JSON)
    arguments = models.JSONField(
        help_text='AI 모델에 전달할 파라미터들'
    )

    # 결과 저장 옵션
    store_result = models.BooleanField(
        default=True,
        help_text='결과 파일을 MinIO에 저장할지 여부'
    )

    # AI 서비스 관련 필드 (FAL.ai 제외)
    # 추후 각 AI 서비스별 필드 추가 예정
    # fal_request_id = models.CharField(
    #     max_length=100,
    #     blank=True,
    #     null=True,
    #     help_text='FAL.ai에서 반환한 request_id'
    # )
    # fal_status_url = models.URLField(
    #     blank=True,
    #     null=True,
    #     help_text='작업 상태 확인 URL'
    # )
    # fal_response_url = models.URLField(
    #     blank=True,
    null=True,
    #     help_text='결과 조회 URL'
    # )
    # fal_cancel_url = models.URLField(
    #     blank=True,
    #     null=True,
    #     help_text='작업 취소 URL'
    # )

    # 임시로 공통 필드 사용 (추후 확장)
    external_job_id = models.CharField(
        max_length=200,
        blank=True,
        null=True,
        help_text='외부 AI 서비스의 작업 ID'
    )

    # 오류 정보
    error = models.TextField(
        blank=True,
        null=True,
        help_text='작업 실패 시 오류 메시지'
    )

    class Meta:
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['status', 'created_at']),
            models.Index(fields=['provider', 'status']),
        ]

    def __str__(self):
        return f"{self.provider} 작업 {self.id} ({self.status})"

    @property
    def is_completed(self):
        """작업이 완료되었는지 확인"""
        return self.status == 'COMPLETED'

    @property
    def is_failed(self):
        """작업이 실패했는지 확인"""
        return self.status == 'FAILED'

    @property
    def duration(self):
        """작업 소요 시간 (완료된 경우만)"""
        if self.is_completed and self.updated_at and self.created_at:
            return (self.updated_at - self.created_at).total_seconds()
        return None


class Artifact(models.Model):
    """
    작업 결과 파일 모델

    생성된 이미지, 비디오 등의 파일을 추적
    """

    # 파일 종류
    KIND_CHOICES = [
        ('image', '이미지'),
        ('video', '비디오'),
        ('file', '기타 파일'),
    ]

    # 기본 필드
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    created_at = models.DateTimeField(auto_now_add=True)

    # 관계
    job = models.ForeignKey(
        Job,
        on_delete=models.CASCADE,
        related_name='artifacts'
    )

    # 파일 정보
    kind = models.CharField(
        max_length=20,
        choices=KIND_CHOICES,
        default='file'
    )
    s3_key = models.CharField(
        max_length=500,
        help_text='MinIO/S3 객체 키'
    )

    # 메타데이터
    mime_type = models.CharField(
        max_length=100,
        help_text='MIME 타입 (예: image/png)'
    )
    size_bytes = models.PositiveBigIntegerField(
        help_text='파일 크기 (바이트)'
    )

    # Presigned URL (임시 접근용)
    presigned_url = models.URLField(
        blank=True,
        null=True,
        help_text='임시 접근 URL (만료됨)'
    )
    presigned_url_expires_at = models.DateTimeField(
        blank=True,
        null=True,
        help_text='Presigned URL 만료 시각'
    )

    class Meta:
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['job', 'kind']),
            models.Index(fields=['created_at']),
        ]

    def __str__(self):
        return f"{self.job.id}의 {self.kind} 아티팩트"

    @property
    def is_presigned_url_valid(self):
        """Presigned URL이 아직 유효한지 확인"""
        if not self.presigned_url_expires_at:
            return False

        from django.utils import timezone
        return timezone.now() < self.presigned_url_expires_at