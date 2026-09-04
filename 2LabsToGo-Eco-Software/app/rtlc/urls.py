from django.urls import path
from .views import analyze_image, extract_bands, make_clusters, list_models

urlpatterns = [
    path('api/rtlc/analyze_image/', analyze_image, name='analyze_image'),
    path('api/rtlc/extract_bands/', extract_bands, name='extract_bands'),
    path('api/rtlc/make_clusters/', make_clusters, name='make_clusters'),
    path('api/rtlc/list_models/', list_models, name='list_models'),
]