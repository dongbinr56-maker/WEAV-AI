# WEAV AI Core 앱 URL 설정

from django.urls import path
from . import views

# 앱 내 URL 패턴
app_name = 'core'

urlpatterns = [
    # 헬스체크 API
    path('health/', views.HealthCheckView.as_view(), name='health-check'),
]