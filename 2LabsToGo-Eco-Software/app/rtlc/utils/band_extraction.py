from pathlib import Path

import numpy as np
from PIL import Image as PILImage


def _make_unique_output_folder(base_output_dir, image_name):
    base_path = Path(base_output_dir)
    candidate = base_path / image_name
    suffix = 1

    while candidate.exists():
        candidate = base_path / f"{image_name}_{suffix}"
        suffix += 1

    candidate.mkdir(parents=True, exist_ok=True)
    return candidate


def extract_and_save_bands(
    image_path,
    analysis_result,
    original_filename,
    base_output_dir,
):
    image = PILImage.open(image_path).convert("RGB")
    image_array = np.asarray(image)
    canvas_height, canvas_width = image_array.shape[:2]

    mask = analysis_result["mask"]
    centers_x = analysis_result.get("rectangle_centers_x", [])
    top_y = float(analysis_result.get("global_top_y", 0.0))
    bottom_y = float(analysis_result.get("global_bottom_y", 0.0))
    rectangle_width = float(analysis_result.get("rectangle_width", 1.0))

    mask_height, mask_width = mask.shape[:2]
    scale_x = canvas_width / mask_width if mask_width > 0 else 1.0
    scale_y = canvas_height / mask_height if mask_height > 0 else 1.0

    y_start = max(0, int(top_y * scale_y))
    y_end = min(canvas_height, int(bottom_y * scale_y))
    if y_end <= y_start:
        return {
            "success": True,
            "output_dir": None,
            "num_bands_extracted": 0,
            "band_paths": [],
        }

    output_folder = _make_unique_output_folder(
        base_output_dir,
        Path(original_filename).stem,
    )
    band_paths = []
    scaled_width = max(1.0, rectangle_width * scale_x)

    for index, center_x in enumerate(centers_x, start=1):
        scaled_center_x = float(center_x) * scale_x
        x_start = max(0, int(scaled_center_x - scaled_width / 2.0))
        x_end = min(canvas_width, int(scaled_center_x + scaled_width / 2.0))

        if x_end <= x_start:
            continue

        cropped = image_array[y_start:y_end, x_start:x_end]
        band_path = output_folder / f"{index:03d}.png"
        PILImage.fromarray(cropped.astype(np.uint8)).save(band_path)
        band_paths.append(str(band_path))

    return {
        "success": True,
        "output_dir": str(output_folder),
        "num_bands_extracted": len(band_paths),
        "band_paths": band_paths,
    }
