from django.urls import path
from . import views

urlpatterns = [
    path('health/', views.health),
    path('studio/trending/', views.youtube_trending),
    path('studio/llm/', views.studio_llm),
    path('studio/image/', views.studio_image),
    path('studio/tts/', views.studio_tts),
    path('studio/video/', views.studio_video),
]
