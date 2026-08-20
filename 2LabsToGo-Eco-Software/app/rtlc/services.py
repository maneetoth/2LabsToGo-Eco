import os
import tempfile
from pathlib import Path
import json
from django.conf import settings

from ultralytics import FastSAM

from .utils.band_geometry import (
    apply_manual_override,
    calculate_band_spacing,
    calculate_band_spacings,
)
from .utils.band_extraction import extract_and_save_bands
from .utils.image_marking import create_marked_image
from .utils.mark import TrackMarker
from .utils.segment import Mask_builder


MODEL_PATH = (
    Path(__file__).resolve().parent.parent
    / "models"
    / "FastSAM-s.pt"
)

MODEL = FastSAM(str(MODEL_PATH))

MARKER = TrackMarker(
    area_tolerance=150,
    split_x_distance_px=30,
    edge_margin_px=20,
    vertical_align_x_tolerance_px=20,
    singleton_line_len_px=30,
    debug=False,
)

MANUAL_FIELDS = (
    "num_bands",
    "first_app_position",
    "edge_cut",
    "migration_front",
    "band_spacing",
    "band_width",
)


def resolve_device():
    return os.getenv("FASTSAM_DEVICE", "cpu")

def _as_list(value):
    """
    Safely parses incoming values that might be a Python list, 
    a JSON-encoded string array, or a comma-separated string.
    """
    if not value:
        return None
    
    # If it's already a list, return it directly
    if isinstance(value, list):
        return value
        
    if isinstance(value, str):
        value_stripped = value.strip()
        
        # Check if the string looks like a JSON array (e.g., '["Sugar", "Band2"]')
        if value_stripped.startswith("[") and value_stripped.endswith("]"):
            try:
                parsed = json.loads(value_stripped)
                if isinstance(parsed, list):
                    return [str(item).strip() for item in parsed if item]
            except json.JSONDecodeError:
                pass  # Fall back to standard string parsing if JSON loading fails
                
        # Otherwise, treat it as a comma-separated string and clean up extra quotes/brackets
        items = []
        for item in value.split(","):
            cleaned = item.strip().strip('[]"\'')
            if cleaned:
                items.append(cleaned)
                
        return items if items else None
        
    return None

def _as_string(value, default):
    if value in (None, ""):
        return default
    return str(value)

def _as_float(value, default):
    if value in (None, ""):
        return default
    return float(value)


def _as_int(value, default):
    return int(_as_float(value, default))


def _analyze_path(image_path):
    mask = Mask_builder(
        [image_path],
        MODEL,
        device=resolve_device(),
    ).get_mask()[0]
    return MARKER.analyze_mask(mask), mask


def _apply_marking_values(result, marking_values):
    marking_values = marking_values or {}
    automatic_summary = MARKER.get_band_summary(result)
    automatic_spacing = calculate_band_spacing(result)

    has_edited_values = any(
        marking_values.get(field) not in (None, "")
        for field in MANUAL_FIELDS
    )
    if not has_edited_values:
        return result

    return apply_manual_override(
        result=result,
        num_bands=_as_int(
            marking_values.get("num_bands"),
            len(result.get("rectangle_centers_x", [])),
        ),
        first_app_position=_as_float(
            marking_values.get("first_app_position"),
            automatic_summary.get("first_app_position") or 0.0,
        ),
        edge_cut=_as_float(
            marking_values.get("edge_cut"),
            automatic_summary.get("edge_cut") or 0.0,
        ),
        migration_front=_as_float(
            marking_values.get("migration_front"),
            automatic_summary.get("migration_front") or 0.0,
        ),
        band_spacing=_as_float(
            marking_values.get("band_spacing"),
            automatic_spacing or 0.0,
        ),
        band_width=_as_float(
            marking_values.get("band_width"),
            result.get("rectangle_width", 1.0),
        ),
    )


def analyze_single_image(uploaded_file, request, marking_values=None):
    suffix = Path(uploaded_file.name).suffix.lower() or ".png"
    image_path = None

    try:
        with tempfile.NamedTemporaryFile(
            suffix=suffix,
            delete=False,
        ) as temp_file:
            for chunk in uploaded_file.chunks():
                temp_file.write(chunk)

            image_path = temp_file.name

        result, mask = _analyze_path(image_path)
        result["mask"] = mask
        result["filename"] = uploaded_file.name
        result = _apply_marking_values(result, marking_values)

        marked_filename = create_marked_image(image_path, result)
        marked_url = request.build_absolute_uri(
            f"{settings.MEDIA_URL}marked_images/{marked_filename}"
        )

        summary = MARKER.get_band_summary(result)
        summary["band_spacing"] = calculate_band_spacing(result)
        summary["band_spacings"] = calculate_band_spacings(result)

        return {
            "filename": uploaded_file.name,
            "marked_image_url": marked_url,
            "rectangle_centers_x": [
                float(value)
                for value in result.get("rectangle_centers_x", [])
            ],
            "global_top_y": float(result.get("global_top_y", 0.0)),
            "global_bottom_y": float(result.get("global_bottom_y", 0.0)),
            "rectangle_width": float(result.get("rectangle_width", 1.0)),
            "summary": summary,
        }

    finally:
        if image_path is not None:
            Path(image_path).unlink(missing_ok=True)


def extract_single_image(uploaded_file, request, marking_values=None):
    suffix = Path(uploaded_file.name).suffix.lower() or ".png"
    image_path = None

    try:
        with tempfile.NamedTemporaryFile(
            suffix=suffix,
            delete=False,
        ) as temp_file:
            for chunk in uploaded_file.chunks():
                temp_file.write(chunk)
            image_path = temp_file.name

        result, mask = _analyze_path(image_path)
        result["mask"] = mask
        result["filename"] = uploaded_file.name
        result = _apply_marking_values(result, marking_values)

        extraction = extract_and_save_bands(
            image_path=image_path,
            analysis_result=result,
            original_filename=uploaded_file.name,
            base_output_dir=Path(settings.MEDIA_ROOT) / "extracted_bands",
        )
        media_root = Path(settings.MEDIA_ROOT)
        band_urls = [
            request.build_absolute_uri(
                f"{settings.MEDIA_URL}"
                f"{Path(path).relative_to(media_root).as_posix()}"
            )
            for path in extraction["band_paths"]
        ]

        return {
            "filename": uploaded_file.name,
            "num_bands_extracted": extraction["num_bands_extracted"],
            "band_urls": band_urls,
            "summary": {
                **MARKER.get_band_summary(result),
                "band_spacing": calculate_band_spacing(result),
                "band_spacings": calculate_band_spacings(result),
            },
            "output_dir": extraction["output_dir"],
        }

    finally:
        if image_path is not None:
            Path(image_path).unlink(missing_ok=True)
