# WEAV AI FAL.ai Queue API 유틸리티
# FAL.ai의 Queue API를 사용하여 비동기 작업 처리
# 현재는 주석 처리되어 있음 - 추후 확장 예정

import requests
import json
import logging
from typing import Dict, Any, Optional, Tuple
from django.conf import settings

logger = logging.getLogger(__name__)


class FalQueueClient:
    """
    FAL.ai Queue API 클라이언트

    Queue 기반 비동기 작업 처리를 위한 인터페이스
    """

    BASE_URL = "https://queue.fal.run"
    TIMEOUT = 30  # 요청 타임아웃 (초)

    def __init__(self, api_key: str = None):
        """
        FAL Queue 클라이언트 초기화

        Args:
            api_key: FAL.ai API 키 (설정에서 가져옴)
        """
        self.api_key = api_key or settings.FAL_KEY
        if not self.api_key:
            raise ValueError("FAL_KEY 설정이 필요합니다")

        self.session = requests.Session()
        self.session.headers.update({
            'Authorization': f'Key {self.api_key}',
            'Content-Type': 'application/json',
        })

    def submit_job(self, model_id: str, arguments: Dict[str, Any],
                   webhook_url: str = None, webhook_secret: str = None,
                   object_lifecycle: Dict[str, Any] = None) -> Dict[str, Any]:
        """
        새 작업을 FAL.ai Queue에 제출

        Args:
            model_id: AI 모델 ID (예: 'fal-ai/fast-sdxl')
            arguments: 모델 입력 파라미터
            webhook_url: 작업 완료 시 호출할 웹훅 URL
            webhook_secret: 웹훅 서명용 시크릿
            object_lifecycle: 파일 라이프사이클 설정

        Returns:
            작업 제출 결과 (request_id, status_url 등)

        Raises:
            requests.RequestException: API 호출 실패
            ValueError: 잘못된 응답
        """
        url = f"{self.BASE_URL}/{model_id}"

        # 요청 데이터 구성
        data = {
            "input": arguments,
        }

        # 웹훅 설정 (선택사항)
        if webhook_url:
            data["webhook_url"] = webhook_url
        if webhook_secret:
            data["webhook_secret"] = webhook_secret

        # Object Lifecycle 설정 (선택사항)
        headers = {}
        if object_lifecycle:
            headers["X-Fal-Object-Lifecycle-Preference"] = json.dumps(object_lifecycle)

        logger.info(f"FAL.ai 작업 제출: {model_id}")
        logger.debug(f"요청 데이터: {data}")

        try:
            response = self.session.post(
                url,
                json=data,
                headers=headers,
                timeout=self.TIMEOUT
            )
            response.raise_for_status()

            result = response.json()
            logger.info(f"FAL.ai 작업 제출 성공: {result.get('request_id')}")

            return result

        except requests.RequestException as e:
            logger.error(f"FAL.ai 작업 제출 실패: {e}")
            raise

    def get_job_status(self, request_id: str) -> Dict[str, Any]:
        """
        작업 상태 조회

        Args:
            request_id: FAL.ai에서 반환한 request_id

        Returns:
            작업 상태 정보

        Raises:
            requests.RequestException: API 호출 실패
        """
        url = f"{self.BASE_URL}/requests/{request_id}/status"

        logger.debug(f"FAL.ai 작업 상태 조회: {request_id}")

        try:
            response = self.session.get(url, timeout=self.TIMEOUT)
            response.raise_for_status()

            result = response.json()
            logger.debug(f"FAL.ai 작업 상태: {result.get('status')}")

            return result

        except requests.RequestException as e:
            logger.error(f"FAL.ai 작업 상태 조회 실패: {e}")
            raise

    def get_job_result(self, request_id: str) -> Dict[str, Any]:
        """
        작업 결과 조회

        Args:
            request_id: FAL.ai에서 반환한 request_id

        Returns:
            작업 결과 데이터

        Raises:
            requests.RequestException: API 호출 실패
        """
        url = f"{self.BASE_URL}/requests/{request_id}"

        logger.debug(f"FAL.ai 작업 결과 조회: {request_id}")

        try:
            response = self.session.get(url, timeout=self.TIMEOUT)
            response.raise_for_status()

            result = response.json()
            logger.debug(f"FAL.ai 작업 결과 조회 성공")

            return result

        except requests.RequestException as e:
            logger.error(f"FAL.ai 작업 결과 조회 실패: {e}")
            raise

    def cancel_job(self, request_id: str) -> Dict[str, Any]:
        """
        작업 취소

        Args:
            request_id: FAL.ai에서 반환한 request_id

        Returns:
            취소 결과

        Raises:
            requests.RequestException: API 호출 실패
        """
        url = f"{self.BASE_URL}/requests/{request_id}/cancel"

        logger.info(f"FAL.ai 작업 취소: {request_id}")

        try:
            response = self.session.post(url, timeout=self.TIMEOUT)
            response.raise_for_status()

            result = response.json()
            logger.info(f"FAL.ai 작업 취소 성공")

            return result

        except requests.RequestException as e:
            logger.error(f"FAL.ai 작업 취소 실패: {e}")
            raise

    def download_file(self, file_url: str, timeout: int = 300) -> bytes:
        """
        FAL.ai에서 생성된 파일 다운로드

        Args:
            file_url: 파일 URL
            timeout: 다운로드 타임아웃 (초)

        Returns:
            파일 바이너리 데이터

        Raises:
            requests.RequestException: 다운로드 실패
        """
        logger.info(f"FAL.ai 파일 다운로드: {file_url}")

        try:
            response = self.session.get(file_url, timeout=timeout)
            response.raise_for_status()

            logger.info(f"FAL.ai 파일 다운로드 성공: {len(response.content)} bytes")
            return response.content

        except requests.RequestException as e:
            logger.error(f"FAL.ai 파일 다운로드 실패: {e}")
            raise


# 글로벌 클라이언트 인스턴스
_fal_client = None


def get_fal_client() -> FalQueueClient:
    """
    FAL.ai 클라이언트 인스턴스 가져오기 (싱글톤)

    Returns:
        FalQueueClient 인스턴스
    """
    global _fal_client
    if _fal_client is None:
        _fal_client = FalQueueClient()
    return _fal_client