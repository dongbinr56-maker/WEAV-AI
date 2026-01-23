# WEAV AI Django 프로젝트 초기화
# Celery 앱이 Django 시작 시 로드되도록 함

# Celery 앱 임포트 (Django 시작 시 Celery 설정 로드)
from .config_celery import app as celery_app

__all__ = ('celery_app',)