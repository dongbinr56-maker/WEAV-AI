from django.urls import path
from . import views

app_name = 'users'

urlpatterns = [
    # 회원가입
    path('register/', views.UserRegistrationView.as_view(), name='register'),

    # 로그인/로그아웃
    path('login/', views.user_login, name='login'),
    path('logout/', views.user_logout, name='logout'),

    # 프로필
    path('profile/', views.user_profile, name='profile'),
]