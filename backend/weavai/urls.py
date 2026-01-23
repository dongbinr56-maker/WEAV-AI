# WEAV AI 메인 URL 설정
# API 버전별 라우팅

from django.contrib import admin
from django.urls import path, include
from django.conf import settings
from django.conf.urls.static import static

urlpatterns = [
    # Django 관리자
    path('admin/', admin.site.urls),

    # API v1 라우팅
    path('api/v1/', include([
        path('', include('apps.core.urls')),
        path('auth/', include('users.urls')),
        path('jobs/', include('apps.jobs.urls')),
        path('storage/', include('apps.storage.urls')),
    ])),

    # 향후 확장 가능
    # path('api/v2/', include('apps.api_v2.urls')),
]

# 개발 환경에서 미디어 파일 서빙
if settings.DEBUG:
    urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)
    urlpatterns += static(settings.STATIC_URL, document_root=settings.STATIC_ROOT)
