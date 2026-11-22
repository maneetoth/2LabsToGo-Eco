import os
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent
SECRET_KEY = os.environ.get("DJANGO_SECRET_KEY") or os.urandom(32).hex()
ALLOWED_HOSTS = ["backend", "localhost", "127.0.0.1"]
ROOT_URLCONF = "urls"
INSTALLED_APPS = ["django.contrib.auth", "django.contrib.contenttypes", "rest_framework", "rtlc"]
MIDDLEWARE = ["django.middleware.csrf.CsrfViewMiddleware"]
DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"
REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": [],
    "DEFAULT_RENDERER_CLASSES": ["rest_framework.renderers.JSONRenderer"],
}

MEDIA_ROOT = BASE_DIR / "media"
MEDIA_URL = "/media/"
DATABASES = {"default": {
    "ENGINE": "django.db.backends.sqlite3",
    "NAME": MEDIA_ROOT / "db.sqlite3",
}}
