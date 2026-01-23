# WEAV AI Jobs 앱 URL 설정

from django.urls import path, include
from rest_framework.routers import DefaultRouter
from . import views

# 앱 내 URL 패턴
app_name = 'jobs'

# DRF Router 설정
router = DefaultRouter()
router.register(r'', views.JobViewSet, basename='job')

urlpatterns = [
    # Job CRUD API
    path('', include(router.urls)),
]