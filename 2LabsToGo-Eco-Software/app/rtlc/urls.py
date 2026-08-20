from django.urls import path
from .views import analyze_image, extract_bands, make_clusters

urlpatterns = [
    path('api/rtlc/analyze_image/', analyze_image, name='analyze_image'),
    path('api/rtlc/extract_bands/', extract_bands, name='extract_bands'),
    path('api/rtlc/make_clusters/', make_clusters, name='make_clusters'),
]