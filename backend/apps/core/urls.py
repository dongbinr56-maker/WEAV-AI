from django.urls import path
from . import views

urlpatterns = [
    path('health/', views.health),
    path('studio/trending/', views.youtube_trending),
    path('studio/youtube-context/', views.studio_youtube_context),
    path('studio/youtube-benchmark-analyze/', views.studio_youtube_benchmark_analyze),
    path('studio/llm/', views.studio_llm),
    path('studio/image/', views.studio_image),
    path('studio/bg-remove/', views.studio_bg_remove),
    path('studio/tts/', views.studio_tts),
    path('studio/video/', views.studio_video),
    path('studio/export/', views.studio_export),
    path('studio/export/job/<str:task_id>/', views.studio_export_job_status),
    path('studio/export/job/<str:task_id>/cancel/', views.studio_export_job_cancel),
]
