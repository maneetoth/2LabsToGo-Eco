from django.conf import settings
from django.conf.urls.static import static


from django.urls import path
from .views import analyze_image, extract_bands

urlpatterns = [

    path('api/rtlc/analyze_image/', analyze_image, name='analyze_image'),
    path('api/rtlc/extract_bands/', extract_bands, name='extract_bands'),
]


if settings.DEBUG:
    urlpatterns += static(
        settings.MEDIA_URL,
        document_root=settings.MEDIA_ROOT,
    )