from django.urls import path

from csrf import csrf
from views import Processed_densitogram, Raw_densitogram, calibrate, peak_integration, read_and_process_image

urlpatterns = [
    path("csrf/", csrf),
    path("read-image/", read_and_process_image),
    path("Raw_densitogram/", Raw_densitogram),
    path("Processed_densitogram/", Processed_densitogram),
    path("peak_integration/", peak_integration),
    path("calibrate/", calibrate),
]
