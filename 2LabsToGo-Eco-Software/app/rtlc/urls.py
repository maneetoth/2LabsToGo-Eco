from django.urls import path
from .views import (
    analyze_image,
    compare_datapoints,
    datapoint,
    extract_bands,
    extracted_bands,
    list_models,
    make_clusters,
)

app_name = "rtlc"

urlpatterns = [
    path('api/rtlc/analyze_image/', analyze_image, name='analyze_image'),
    path('api/rtlc/extract_bands/', extract_bands, name='extract_bands'),
    path('api/rtlc/extracted_bands/', extracted_bands, name='extracted_bands'),
    path('api/rtlc/datapoint/', datapoint, name='datapoint'),
    path('api/rtlc/compare_datapoints/', compare_datapoints, name='compare_datapoints'),
    path('api/rtlc/make_clusters/', make_clusters, name='make_clusters'),
    path('api/rtlc/list_models/', list_models, name='list_models'),
]