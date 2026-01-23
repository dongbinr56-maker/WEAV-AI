#!/bin/bash

# WEAV AI Backend Setup Script
echo "🚀 Setting up WEAV AI Backend..."

# Create virtual environment
echo "📦 Creating virtual environment..."
python3 -m venv venv

# Activate virtual environment
echo "🔄 Activating virtual environment..."
source venv/bin/activate

# Upgrade pip
echo "⬆️ Upgrading pip..."
pip install --upgrade pip

# Install requirements
echo "📚 Installing Python packages..."
pip install -r requirements.txt

# Create Django project
echo "🎯 Setting up Django project..."
if [ ! -d "weav_ai" ]; then
    django-admin startproject weav_ai .
fi

cd weav_ai

# Create Django apps if they don't exist
if [ ! -d "users" ]; then
    django-admin startapp users
fi
if [ ! -d "ai_services" ]; then
    django-admin startapp ai_services
fi
if [ ! -d "payments" ]; then
    django-admin startapp payments
fi

cd ..

# Setup basic Django settings
echo "⚙️ Configuring Django settings..."
if [ -f "settings_template.py" ] && [ ! -f "weav_ai/weav_ai/settings.py" ]; then
    cp settings_template.py weav_ai/weav_ai/settings.py
fi

echo "✅ Backend setup complete!"
echo ""
echo "📋 Next steps:"
echo "1. Configure database in settings.py"
echo "2. Run: python manage.py makemigrations"
echo "3. Run: python manage.py migrate"
echo "4. Run: python manage.py createsuperuser"
echo "5. Run: python manage.py runserver"