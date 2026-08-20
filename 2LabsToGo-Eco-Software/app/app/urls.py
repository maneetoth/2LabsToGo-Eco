"""app URL Configuration

The `urlpatterns` list routes URLs to views. For more information please see:
    https://docs.djangoproject.com/en/2.1/topics/http/urls/
Examples:
Function views
    1. Add an import:  from my_app import views
    2. Add a URL to urlpatterns:  path('', views.home, name='home')
Class-based views
    1. Add an import:  from other_app.views import Home
    2. Add a URL to urlpatterns:  path('', Home.as_view(), name='home')
Including another URLconf
    1. Import the include() function: from django.urls import include, path
    2. Add a URL to urlpatterns:  path('blog/', include('blog.urls'))
"""
from django.contrib import admin
from django.urls import path
from django.conf import settings
from django.conf.urls.static import static
from django.conf.urls import include
from django.views.generic import TemplateView
from django.urls import re_path
from django.http import HttpResponse
from .next_proxy import proxy_to_nextjs

urlpatterns = [
    path('admin/', admin.site.urls),
    path('', include('accounts.urls')),
    path('', include('finecontrol.urls')),
    path('', include('connection.urls')),
    path('', include('sampleapp.urls')),
    path('', include('rtlc.urls')),
    path('', include('development.urls')),
    path('', include('detection.urls')),
    path("healthz/", lambda r: HttpResponse("ok saasfjhsvhd", content_type="text/plain")),
    path("api/healthz/", lambda r: HttpResponse("ok django working", content_type="text/plain")),

    # Serve Next.js through Django when accessing port 8000 directly.
    re_path(r"^next/(?P<path>.*)$", proxy_to_nextjs),

]

if settings.DEBUG:
    # Serve /media/ with X-Frame-Options exempted so it can be embedded
    # in the Shiny app's iframe (different port = different origin).
    urlpatterns += [
        re_path(
            r'^media/(?P<path>.*)$',
            xframe_options_exempt(serve),
            {'document_root': settings.MEDIA_ROOT},
        ),
    ]
"""
if settings.DEBUG:
    urlpatterns += static(
            settings.MEDIA_URL,
            document_root=settings.MEDIA_ROOT)
"""
