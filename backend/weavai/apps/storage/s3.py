# WEAV AI Storage 앱 S3 유틸리티
# MinIO/S3 호환 스토리지 인터페이스

import boto3
import logging
from botocore.exceptions import ClientError
from django.conf import settings
from typing import Optional, Dict, Any

logger = logging.getLogger(__name__)


class S3Storage:
    """
    MinIO/S3 호환 스토리지 클라이언트

    외장하드에 MinIO로 구축된 S3 호환 스토리지를 다루는 유틸리티 클래스
    """

    def __init__(self):
        """
        S3 클라이언트 초기화

        Django 설정에서 MinIO 연결 정보를 가져옴
        """
        self.bucket_name = settings.AWS_STORAGE_BUCKET_NAME
        self.presigned_url_expiration = getattr(settings, 'PRESIGNED_URL_EXPIRATION', 3600)

        # boto3 클라이언트 생성
        self.client = boto3.client(
            's3',
            endpoint_url=settings.AWS_S3_ENDPOINT_URL,
            aws_access_key_id=settings.AWS_ACCESS_KEY_ID,
            aws_secret_access_key=settings.AWS_SECRET_ACCESS_KEY,
            region_name=getattr(settings, 'AWS_S3_REGION_NAME', 'us-east-1'),
            use_ssl=getattr(settings, 'AWS_S3_USE_SSL', False),
            config=boto3.session.Config(
                signature_version='s3v4',  # MinIO 호환을 위해 s3v4 사용
            )
        )

        logger.debug(f"S3 클라이언트 초기화: {settings.AWS_S3_ENDPOINT_URL}")

    def upload_file(self, file_content: bytes, key: str,
                   content_type: str = 'application/octet-stream',
                   metadata: Optional[Dict[str, str]] = None) -> str:
        """
        파일을 S3에 업로드

        Args:
            file_content: 업로드할 파일 바이너리 데이터
            key: S3 객체 키 (경로)
            content_type: MIME 타입
            metadata: 추가 메타데이터

        Returns:
            업로드된 객체의 키

        Raises:
            ClientError: 업로드 실패
        """
        try:
            # 업로드 파라미터 구성
            params = {
                'Bucket': self.bucket_name,
                'Key': key,
                'Body': file_content,
                'ContentType': content_type,
            }

            # 메타데이터 추가
            if metadata:
                params['Metadata'] = metadata

            # S3 객체 파라미터 추가 (캐시 설정 등)
            if hasattr(settings, 'AWS_S3_OBJECT_PARAMETERS'):
                params.update(settings.AWS_S3_OBJECT_PARAMETERS)

            logger.info(f"S3 파일 업로드: {key} ({len(file_content)} bytes)")

            # 업로드 실행
            self.client.put_object(**params)

            logger.info(f"S3 파일 업로드 성공: {key}")
            return key

        except ClientError as e:
            logger.error(f"S3 파일 업로드 실패: {key} - {e}")
            raise

    def download_file(self, key: str) -> bytes:
        """
        S3에서 파일 다운로드

        Args:
            key: S3 객체 키

        Returns:
            파일 바이너리 데이터

        Raises:
            ClientError: 다운로드 실패
        """
        try:
            logger.debug(f"S3 파일 다운로드: {key}")

            response = self.client.get_object(Bucket=self.bucket_name, Key=key)

            file_content = response['Body'].read()

            logger.debug(f"S3 파일 다운로드 성공: {key} ({len(file_content)} bytes)")
            return file_content

        except ClientError as e:
            logger.error(f"S3 파일 다운로드 실패: {key} - {e}")
            raise

    def delete_file(self, key: str) -> None:
        """
        S3에서 파일 삭제

        Args:
            key: S3 객체 키

        Raises:
            ClientError: 삭제 실패
        """
        try:
            logger.info(f"S3 파일 삭제: {key}")

            self.client.delete_object(Bucket=self.bucket_name, Key=key)

            logger.info(f"S3 파일 삭제 성공: {key}")

        except ClientError as e:
            logger.error(f"S3 파일 삭제 실패: {key} - {e}")
            raise

    def generate_presigned_url(self, key: str, expiration: Optional[int] = None) -> str:
        """
        S3 객체에 대한 임시 접근 URL 생성

        Args:
            key: S3 객체 키
            expiration: URL 만료 시간 (초), 기본값은 설정값 사용

        Returns:
            Presigned URL

        Raises:
            ClientError: URL 생성 실패
        """
        try:
            expires_in = expiration or self.presigned_url_expiration

            logger.debug(f"Presigned URL 생성: {key} ({expires_in}초)")

            url = self.client.generate_presigned_url(
                'get_object',
                Params={
                    'Bucket': self.bucket_name,
                    'Key': key
                },
                ExpiresIn=expires_in
            )

            logger.debug(f"Presigned URL 생성 성공: {key}")
            return url

        except ClientError as e:
            logger.error(f"Presigned URL 생성 실패: {key} - {e}")
            raise

    def get_file_info(self, key: str) -> Dict[str, Any]:
        """
        S3 객체의 메타데이터 조회

        Args:
            key: S3 객체 키

        Returns:
            파일 정보 딕셔너리

        Raises:
            ClientError: 조회 실패
        """
        try:
            logger.debug(f"S3 파일 정보 조회: {key}")

            response = self.client.head_object(Bucket=self.bucket_name, Key=key)

            info = {
                'key': key,
                'size': response.get('ContentLength', 0),
                'content_type': response.get('ContentType', 'application/octet-stream'),
                'last_modified': response.get('LastModified'),
                'etag': response.get('ETag', '').strip('"'),
                'metadata': response.get('Metadata', {}),
            }

            logger.debug(f"S3 파일 정보 조회 성공: {key}")
            return info

        except ClientError as e:
            logger.error(f"S3 파일 정보 조회 실패: {key} - {e}")
            raise

    def list_files(self, prefix: str = '', max_keys: int = 1000) -> list:
        """
        S3 버킷에서 파일 목록 조회

        Args:
            prefix: 파일 키 접두사 (폴더처럼 사용)
            max_keys: 최대 반환 개수

        Returns:
            파일 정보 리스트

        Raises:
            ClientError: 조회 실패
        """
        try:
            logger.debug(f"S3 파일 목록 조회: prefix='{prefix}', max_keys={max_keys}")

            response = self.client.list_objects_v2(
                Bucket=self.bucket_name,
                Prefix=prefix,
                MaxKeys=max_keys
            )

            files = []
            if 'Contents' in response:
                for obj in response['Contents']:
                    files.append({
                        'key': obj['Key'],
                        'size': obj['Size'],
                        'last_modified': obj['LastModified'],
                        'etag': obj['ETag'].strip('"'),
                    })

            logger.debug(f"S3 파일 목록 조회 성공: {len(files)}개 파일")
            return files

        except ClientError as e:
            logger.error(f"S3 파일 목록 조회 실패: prefix='{prefix}' - {e}")
            raise

    def create_bucket_if_not_exists(self) -> None:
        """
        버킷이 존재하지 않으면 생성

        MinIO 초기 설정용
        """
        try:
            # 버킷 존재 확인
            self.client.head_bucket(Bucket=self.bucket_name)
            logger.debug(f"버킷 이미 존재: {self.bucket_name}")

        except ClientError as e:
            error_code = e.response['Error']['Code']
            if error_code == '404' or error_code == 'NoSuchBucket':
                # 버킷 생성
                logger.info(f"버킷 생성: {self.bucket_name}")
                self.client.create_bucket(Bucket=self.bucket_name)

                # 퍼블릭 읽기 정책 설정
                policy = {
                    "Version": "2012-10-17",
                    "Statement": [
                        {
                            "Effect": "Allow",
                            "Principal": {"AWS": "*"},
                            "Action": "s3:GetObject",
                            "Resource": f"arn:aws:s3:::{self.bucket_name}/*"
                        }
                    ]
                }

                import json
                self.client.put_bucket_policy(
                    Bucket=self.bucket_name,
                    Policy=json.dumps(policy)
                )

                logger.info(f"버킷 생성 및 정책 설정 완료: {self.bucket_name}")
            else:
                logger.error(f"버킷 확인 실패: {self.bucket_name} - {e}")
                raise