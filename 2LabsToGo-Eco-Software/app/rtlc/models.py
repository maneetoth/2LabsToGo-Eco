from django.db import models

# Create your models here.
# rtlc/models.py
import uuid
from django.db import models


class UploadedImage(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    session_key = models.CharField(max_length=64, db_index=True)  # ties images to an upload batch/session
    original_name = models.CharField(max_length=255)
    file = models.ImageField(upload_to="uploads/%Y/%m/%d/")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["created_at"]

    def __str__(self):
        return self.original_name


class AnalysisResult(models.Model):
    """Mirrors the dict returned by marker.analyze_mask()."""
    image = models.OneToOneField(UploadedImage, on_delete=models.CASCADE, related_name="analysis")

    # Mask is a numpy array in Shiny — store it as a file (.npy) rather than in JSON.
    mask_file = models.FileField(upload_to="masks/%Y/%m/%d/")
    mask_height = models.IntegerField()
    mask_width = models.IntegerField()

    rectangle_centers_x = models.JSONField(default=list)   # list[float]
    rectangle_width = models.FloatField(default=1.0)
    global_top_y = models.FloatField(default=0.0)
    global_bottom_y = models.FloatField(default=0.0)
    consistent_group_spacing = models.FloatField(null=True, blank=True)

    # Catch-all for any extra keys analyze_mask() returns that aren't modeled explicitly above
    raw_result = models.JSONField(default=dict, blank=True)

    created_at = models.DateTimeField(auto_now_add=True)


class ImageSettings(models.Model):
    """Mirrors the per-image dict in Shiny's image_state reactive.Value."""
    image = models.OneToOneField(UploadedImage, on_delete=models.CASCADE, related_name="settings")

    manual_mode = models.BooleanField(default=False)
    num_bands = models.IntegerField(default=0)
    first_app_position = models.FloatField(default=0.0)
    edge_cut = models.FloatField(default=0.0)
    migration_front = models.FloatField(default=0.0)
    band_spacing = models.FloatField(default=30.0)
    band_width = models.FloatField(default=1.0)

    updated_at = models.DateTimeField(auto_now=True)


class ExtractedBand(models.Model):
    image = models.ForeignKey(UploadedImage, on_delete=models.CASCADE, related_name="bands")
    index = models.PositiveIntegerField()
    file = models.ImageField(upload_to="extracted_bands/%Y/%m/%d/")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["index"]