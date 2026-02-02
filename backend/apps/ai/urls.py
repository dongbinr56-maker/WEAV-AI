from django.urls import path
from . import views

urlpatterns = [
    path('complete/', views.complete_chat),
    path('regenerate/', views.regenerate_chat),
    path('image/regenerate/', views.regenerate_image),
    path('image/', views.complete_image),
    path('image/upload-reference/', views.upload_reference_image),
    path('job/<str:task_id>/cancel/', views.job_cancel),
    path('job/<str:task_id>/', views.job_status),
]
