"""
Django settings for WEAV AI.
테스트·실행은 Docker 환경 기준으로만 진행합니다.
"""
from pathlib import Path
from decouple import config, Csv
import os
import sys

from django.core.exceptions import ImproperlyConfigured

from dotenv import load_dotenv

TESTING = 'test' in sys.argv
load_dotenv()

BASE_DIR = Path(__file__).resolve().parent.parent

def _bool(val):
    if isinstance(val, bool):
        return val
    v = str(val).strip().lower()
    if v in ('true', '1', 'yes', 'on'):
        return True
    if v in ('false', '0', 'no', 'off', 'warn', ''):
        return False
    return False

_RAW_SECRET_KEY = config('SECRET_KEY', default='change-me-in-production')
SECRET_KEY = _RAW_SECRET_KEY
DEBUG = _bool(config('DEBUG', default=True))
if not DEBUG and not TESTING and SECRET_KEY == 'change-me-in-production':
    raise ImproperlyConfigured(
        'SECRET_KEY must be set to a secure value in production. '
        'Set SECRET_KEY in your environment or .env file.'
    )
ALLOWED_HOSTS = config('ALLOWED_HOSTS', default='localhost,127.0.0.1,api', cast=Csv())

AUTH_USER_MODEL = 'users.User'

INSTALLED_APPS = [
    'django.contrib.admin',
    'django.contrib.auth',
    'django.contrib.contenttypes',
    'django.contrib.sessions',
    'django.contrib.messages',
    'django.contrib.staticfiles',
    'rest_framework',
    'corsheaders',
    'pgvector',
    'apps.users',
    'apps.chats',
    'apps.core',
    'apps.ai',
    'jobs',
]

MIDDLEWARE = [
    'corsheaders.middleware.CorsMiddleware',
    'django.middleware.security.SecurityMiddleware',
    'django.contrib.sessions.middleware.SessionMiddleware',
    'django.middleware.common.CommonMiddleware',
    'django.middleware.csrf.CsrfViewMiddleware',
    'django.contrib.auth.middleware.AuthenticationMiddleware',
    'django.contrib.messages.middleware.MessageMiddleware',
    'django.middleware.clickjacking.XFrameOptionsMiddleware',
]

ROOT_URLCONF = 'config.urls'
WSGI_APPLICATION = 'config.wsgi.application'

TEMPLATES = [
    {
        'BACKEND': 'django.template.backends.django.DjangoTemplates',
        'DIRS': [],
        'APP_DIRS': True,
        'OPTIONS': {
            'context_processors': [
                'django.template.context_processors.debug',
                'django.template.context_processors.request',
                'django.contrib.auth.context_processors.auth',
                'django.contrib.messages.context_processors.messages',
            ],
        },
    },
]

_db_url = config('DATABASE_URL', default='')
if _db_url:
    if _db_url.startswith('postgres://'):
        _db_url = _db_url.replace('postgres://', 'postgresql://', 1)
    import dj_database_url
    DATABASES = {'default': dj_database_url.parse(_db_url)}
else:
    DATABASES = {
        'default': {
            'ENGINE': 'django.db.backends.sqlite3',
            'NAME': BASE_DIR / 'db.sqlite3',
        }
    }

LANGUAGE_CODE = 'ko-kr'
TIME_ZONE = 'Asia/Seoul'
USE_I18N = True
USE_TZ = True

STATIC_URL = '/static/'
STATIC_ROOT = BASE_DIR / 'staticfiles'

MEDIA_URL = '/media/'
MEDIA_ROOT = BASE_DIR / 'media'

DEFAULT_AUTO_FIELD = 'django.db.models.BigAutoField'

REST_FRAMEWORK = {
    'DEFAULT_PERMISSION_CLASSES': ['rest_framework.permissions.AllowAny'],
    'DEFAULT_RENDERER_CLASSES': ['rest_framework.renderers.JSONRenderer'],
}

CORS_ALLOW_ALL_ORIGINS = DEBUG
# DEBUG가 꺼져 있을 때(예: Docker) 프론트 오리진 허용. 기본값에 로컬 개발 주소 포함
_DEFAULT_CORS_ORIGINS = 'http://localhost:3000,http://localhost:3001,http://127.0.0.1:3000,http://127.0.0.1:3001'
if not DEBUG:
    CORS_ALLOWED_ORIGINS = config('CORS_ALLOWED_ORIGINS', default=_DEFAULT_CORS_ORIGINS, cast=Csv())

CELERY_BROKER_URL = config('CELERY_BROKER_URL', default='redis://localhost:6379/0')
CELERY_RESULT_BACKEND = config('CELERY_RESULT_BACKEND', default=CELERY_BROKER_URL)

# Cache for django-ratelimit (Studio API). Use Redis if available.
_broker = CELERY_BROKER_URL or ''
if _broker.startswith('redis://'):
    CACHES = {
        'default': {
            'BACKEND': 'django.core.cache.backends.redis.RedisCache',
            'LOCATION': _broker.replace('/0', '/1'),  # DB 1 for cache
        }
    }
else:
    CACHES = {
        'default': {'BACKEND': 'django.core.cache.backends.locmem.LocMemCache'}
    }
CELERY_ACCEPT_CONTENT = ['json']
CELERY_TASK_SERIALIZER = 'json'
CELERY_RESULT_SERIALIZER = 'json'

FAL_KEY = config('FAL_KEY', default='')

# MinIO Settings
MINIO_ENDPOINT = config('MINIO_ENDPOINT', default='localhost:9000')
# Default values aligned with infra/docker-compose.yml. Production: set MINIO_ACCESS_KEY, MINIO_SECRET_KEY explicitly.
MINIO_ACCESS_KEY = config('MINIO_ACCESS_KEY', default='weavai_admin')
MINIO_SECRET_KEY = config('MINIO_SECRET_KEY', default='minio123')
if not DEBUG and not TESTING and MINIO_SECRET_KEY == 'minio123':
    raise ImproperlyConfigured(
        'MINIO_SECRET_KEY must be changed in production. Set MINIO_SECRET_KEY (or MINIO_ROOT_PASSWORD in docker-compose) to a strong value.'
    )
MINIO_BUCKET_NAME = config('MINIO_BUCKET_NAME', default='weav-ai')
MINIO_USE_SSL = _bool(config('MINIO_USE_SSL', default=False))
MINIO_PUBLIC_ENDPOINT = config('MINIO_PUBLIC_ENDPOINT', default=MINIO_ENDPOINT)
MINIO_PUBLIC_USE_SSL = _bool(config('MINIO_PUBLIC_USE_SSL', default=MINIO_USE_SSL))
# Browser-facing endpoint used for presigned URLs returned to the frontend.
# In Docker, MINIO_ENDPOINT is typically `minio:9000` (internal) which the browser cannot resolve.
# Keep this configurable separately from MINIO_PUBLIC_ENDPOINT (fal / external workers).
MINIO_BROWSER_ENDPOINT = config('MINIO_BROWSER_ENDPOINT', default=MINIO_PUBLIC_ENDPOINT)
MINIO_BROWSER_USE_SSL = _bool(config('MINIO_BROWSER_USE_SSL', default=MINIO_PUBLIC_USE_SSL))
