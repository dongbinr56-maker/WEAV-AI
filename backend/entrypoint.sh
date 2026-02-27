#!/bin/sh

# This is a placeholder for a script that would wait for the DB to be ready
# In a real-world scenario, you would use a tool like docker-compose-wait or a custom script
# to check for the DB connection before proceeding.
echo "Waiting for database..."
# For now, we'll just sleep for a few seconds
sleep 5

echo "Applying database migrations..."
python manage.py migrate

echo "Collecting static files..."
python manage.py collectstatic --noinput

echo "Starting Gunicorn..."
gunicorn config.wsgi:application \
  --bind 0.0.0.0:8000 \
  --timeout "${GUNICORN_TIMEOUT:-300}" \
  --graceful-timeout "${GUNICORN_GRACEFUL_TIMEOUT:-30}"
