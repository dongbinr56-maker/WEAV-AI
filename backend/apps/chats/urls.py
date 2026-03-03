from django.urls import path
from . import views

urlpatterns = [
    path('', views.session_list),
    path('bulk-delete/', views.session_bulk_delete),
    path('<int:session_id>/', views.session_detail),
    path('<int:session_id>/messages/', views.session_messages),
    path('<int:session_id>/images/', views.session_images),
    path('<int:session_id>/documents/', views.session_documents),
    path('<int:session_id>/documents/<int:document_id>/file/', views.session_document_file, name='session_document_file'),
    path('<int:session_id>/documents/<int:document_id>/', views.session_document_delete),
    path('<int:session_id>/upload/', views.session_upload),
]
