from pathlib import Path
from uuid import uuid4

from django.conf import settings
from PIL import Image, ImageDraw


def create_marked_image(image_path, result):
    image = Image.open(image_path).convert("RGB")
    draw = ImageDraw.Draw(image)

    image_width, image_height = image.size
    mask_height, mask_width = result["mask"].shape[:2]

    scale_x = image_width / mask_width
    scale_y = image_height / mask_height

    top_y = float(result.get("global_top_y", 0.0)) * scale_y
    bottom_y = float(result.get("global_bottom_y", 0.0)) * scale_y
    rectangle_width = float(result.get("rectangle_width", 1.0)) * scale_x

    for center_x in result.get("rectangle_centers_x", []):
        center_x = float(center_x) * scale_x
        left = center_x - rectangle_width / 2
        right = center_x + rectangle_width / 2

        draw.rectangle(
            [left, top_y, right, bottom_y],
            outline="cyan",
            width=3,
        )

    output_directory = Path(settings.MEDIA_ROOT) / "marked_images"
    output_directory.mkdir(parents=True, exist_ok=True)

    original_stem = Path(result["filename"]).stem
    output_filename = f"{original_stem}_marked_{uuid4().hex[:8]}.png"
    image.save(output_directory / output_filename)

    return output_filename
