FROM python:3.11-slim-bookworm
WORKDIR /app
ENV DJANGO_SETTINGS_MODULE=settings PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1 MPLBACKEND=Agg
RUN apt-get update && apt-get install -y --no-install-recommends libgl1 libglib2.0-0 && rm -rf /var/lib/apt/lists/*
RUN pip install --no-cache-dir torch==2.5.1 torchvision==0.20.1 --index-url https://download.pytorch.org/whl/cpu
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
EXPOSE 8000
CMD ["sh", "-ec", "python -m django migrate --noinput && exec gunicorn --bind 0.0.0.0:8000 --timeout 300 'django.core.wsgi:get_wsgi_application()'"]
