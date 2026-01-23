"""
WSGI config for weavai project.

It exposes the WSGI callable as a module-level variable named ``application``.

For more information on this file, see
https://docs.djangoproject.com/en/4.2/howto/deployment/wsgi/
"""

import os
import sys

# Python 경로 설정 (Django 설정 전에 해야 함)
# wsgi.py는 /app/weavai/wsgi.py에 있으므로
# /app을 Python 경로에 추가
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
# weavai 폴더도 추가 (apps 모듈을 찾기 위해)
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from django.core.wsgi import get_wsgi_application

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'weavai.settings')

application = get_wsgi_application()
