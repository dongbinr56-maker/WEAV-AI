# WEAV AI Celery 설정
# 비동기 작업 처리를 위한 설정

import os
from celery import Celery
from celery.schedules import crontab

# Django 설정 모듈 설정
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'weavai.settings')

# Celery 앱 생성
app = Celery('weavai')

# Django settings에서 Celery 설정 로드
app.config_from_object('django.conf:settings', namespace='CELERY')

# 작업 모듈 자동 탐색
app.autodiscover_tasks()

# ===== 주기적 작업 설정 =====
# (Celery Beat에서 사용)
app.conf.beat_schedule = {
    # 매일 자정에 완료된 오래된 작업 정리
    'cleanup-old-jobs': {
        'task': 'apps.jobs.tasks.cleanup_old_jobs',
        'schedule': crontab(hour=0, minute=0),  # 매일 00:00
    },
}

# ===== 작업 라우팅 =====
# 특정 작업을 특정 큐로 라우팅
app.conf.task_routes = {
    # FAL.ai 관련 작업들 - 추후 확장 예정
    # 'apps.jobs.tasks.submit_fal_job': {'queue': 'fal_jobs'},
    # 'apps.jobs.tasks.poll_fal_job': {'queue': 'fal_jobs'},
    # 'apps.jobs.tasks.finalize_job': {'queue': 'fal_jobs'},

    # 유지보수 작업
    'apps.jobs.tasks.cleanup_old_jobs': {'queue': 'maintenance'},
}

# ===== 작업 설정 =====
app.conf.task_acks_late = True          # 작업 완료 후 ACK
app.conf.task_reject_on_worker_lost = True  # 워커 죽으면 작업 재큐
app.conf.worker_prefetch_multiplier = 1     # 한 번에 하나의 작업만
app.conf.task_default_retry_delay = 60      # 재시도 기본 지연 (60초)
app.conf.task_max_retries = 3               # 최대 재시도 횟수

# ===== 로깅 =====
app.conf.worker_log_format = '[%(asctime)s: %(levelname)s/%(processName)s] %(message)s'
app.conf.worker_task_log_format = '[%(asctime)s: %(levelname)s/%(processName)s][%(task_name)s(%(task_id)s)] %(message)s'

# Django가 시작될 때 Celery 앱이 import되도록 함
@app.on_after_configure.connect
def setup_periodic_tasks(sender, **kwargs):
    """주기적 작업 추가 설정"""
    pass

# 개발 환경에서 작업 테스트용
if __name__ == '__main__':
    app.start()