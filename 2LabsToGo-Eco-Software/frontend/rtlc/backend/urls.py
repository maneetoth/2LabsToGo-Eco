from django.conf import settings
from django.urls import include, path, re_path
from django.views.static import serve

from csrf import csrf

def serve_result(request, path):
    return serve(request, path, document_root=settings.MEDIA_ROOT)


urlpatterns = [
    path("csrf/", csrf),
    path("", include("rtlc.urls")),
    re_path(r"^media/(?P<path>(?:marked_images|extracted_bands|clusters)/.+)$",
            serve_result),
]
