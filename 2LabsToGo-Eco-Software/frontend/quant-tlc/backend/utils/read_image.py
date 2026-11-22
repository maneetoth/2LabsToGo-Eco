import numpy as np
from PIL import Image, ImageOps


def read_image(upload):
    """Decode an uploaded plate from JPEG, PNG, TIFF or another Pillow format."""
    with Image.open(upload) as image:
        plate = ImageOps.exif_transpose(image).convert("RGB")
        return np.asarray(plate)
