#!/bin/sh

echo "Waiting for database..."
max=30
i=0
while [ $i -lt $max ]; do
  if python -c "
import os
import django
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')
django.setup()
from django.db import connection
connection.ensure_connection()
" 2>/dev/null; then
    echo "Database is ready."
    break
  fi
  i=$((i + 1))
  echo "Waiting for database... ($i/$max)"
  sleep 2
done
if [ $i -eq $max ]; then
  echo "Database wait timed out."
  exit 1
fi

echo "Applying database migrations..."
python manage.py migrate

echo "Collecting static files..."
python manage.py collectstatic --noinput

echo "Starting Gunicorn..."
gunicorn config.wsgi:application \
  --bind 0.0.0.0:8000 \
  --timeout "${GUNICORN_TIMEOUT:-600}" \
  --graceful-timeout "${GUNICORN_GRACEFUL_TIMEOUT:-30}"
