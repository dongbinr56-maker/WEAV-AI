from django.urls import path
from . import views

urlpatterns = [
    path('', views.session_list),
    path('<int:session_id>/', views.session_detail),
    path('<int:session_id>/messages/', views.session_messages),
    path('<int:session_id>/images/', views.session_images),
    path('<int:session_id>/upload/', views.session_upload),
]
