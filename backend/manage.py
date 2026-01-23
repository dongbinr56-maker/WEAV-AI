#!/usr/bin/env python
"""Django's command-line utility for administrative tasks."""
import os
import sys


def main():
    """Run administrative tasks."""
    # Python 경로 설정 (Django 설정 전에 해야 함)
    import sys
    # backend 폴더를 Python 경로에 추가
    sys.path.insert(0, os.path.dirname(__file__))
    # weavai 폴더를 Python 경로에 추가 (apps 모듈을 찾기 위해)
    sys.path.insert(0, os.path.join(os.path.dirname(__file__), 'weavai'))
    
    # Django 설정 모듈 설정
    os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'weavai.settings')
    try:
        from django.core.management import execute_from_command_line
    except ImportError as exc:
        raise ImportError(
            "Couldn't import Django. Are you sure it's installed and "
            "available on your PYTHONPATH environment variable? Did you "
            "forget to activate a virtual environment?"
        ) from exc
    execute_from_command_line(sys.argv)


if __name__ == '__main__':
    main()
