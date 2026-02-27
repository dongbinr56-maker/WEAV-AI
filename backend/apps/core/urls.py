from django.urls import path
from . import views

urlpatterns = [
    path('health/', views.health),
    path('studio/trending/', views.youtube_trending),
    path('studio/youtube-context/', views.studio_youtube_context),
    path('studio/youtube-benchmark-analyze/', views.studio_youtube_benchmark_analyze),
    path('studio/llm/', views.studio_llm),
    path('studio/image/', views.studio_image),
    path('studio/tts/', views.studio_tts),
]
