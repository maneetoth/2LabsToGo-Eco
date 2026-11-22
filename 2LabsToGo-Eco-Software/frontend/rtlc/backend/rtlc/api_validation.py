import json
import math
from pathlib import Path

from PIL import Image
from rest_framework.response import Response


MAX_IMAGE_SIZE_BYTES = 300 * 1024 * 1024
ALLOWED_IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".tif", ".tiff"}
MARKING_FIELDS = {
    "num_bands",
    "first_app_position",
    "edge_cut",
    "migration_front",
    "band_spacing",
    "band_width",
}


def _parse_marking_values(raw_marking_values):
    if hasattr(raw_marking_values, "read"):
        raw_marking_values = raw_marking_values.read()
        if isinstance(raw_marking_values, bytes):
            raw_marking_values = raw_marking_values.decode("utf-8")

    marking_values = json.loads(raw_marking_values)
    if not isinstance(marking_values, dict):
        raise ValueError(
            "marking_values must be an object keyed by image filename."
        )

    if any(
        not isinstance(values, dict)
        for values in marking_values.values()
    ):
        raise ValueError(
            "Each marking_values entry must contain an object of fields."
        )

    return marking_values


def get_marking_values(request, uploaded_files):
    raw_marking_values = request.data.get("marking_values")
    if not raw_marking_values:
        return {}

    try:
        marking_values = _parse_marking_values(raw_marking_values)
    except (TypeError, UnicodeDecodeError, json.JSONDecodeError, ValueError):
        return Response(
            {
                "error": (
                    "marking_values must be valid JSON keyed by "
                    "image filename."
                )
            },
            status=400,
        )

    uploaded_names = {uploaded_file.name for uploaded_file in uploaded_files}
    unknown_names = sorted(set(marking_values) - uploaded_names)
    if unknown_names:
        return Response(
            {
                "error": (
                    "No uploaded image matches these marking_values "
                    f"keys: {unknown_names}. Uploaded filenames: "
                    f"{sorted(uploaded_names)}."
                )
            },
            status=400,
        )

    unknown_fields = sorted(
        {
            field
            for values in marking_values.values()
            for field in values
            if field not in MARKING_FIELDS
        }
    )
    if unknown_fields:
        return Response(
            {
                "error": (
                    f"Unknown marking_values fields: {unknown_fields}. "
                    f"Allowed fields: {sorted(MARKING_FIELDS)}."
                )
            },
            status=400,
        )

    try:
        for values in marking_values.values():
            for field, value in values.items():
                if value in (None, ""):
                    continue
                if isinstance(value, bool):
                    raise ValueError(field)
                number = float(value)
                if not math.isfinite(number) or number < 0:
                    raise ValueError(field)
                if field == "num_bands" and number != int(number):
                    raise ValueError(field)
    except (TypeError, ValueError):
        return Response(
            {
                "error": (
                    "Marking values must be valid non-negative numbers; "
                    "num_bands must be an integer."
                )
            },
            status=400,
        )

    return marking_values


def validate_uploaded_images(uploaded_files):
    filenames = [uploaded_file.name for uploaded_file in uploaded_files]
    duplicates = sorted(
        filename
        for filename in set(filenames)
        if filenames.count(filename) > 1
    )
    if duplicates:
        return Response(
            {
                "error": (
                    "Uploaded image filenames must be unique: "
                    f"{duplicates}."
                )
            },
            status=400,
        )

    for uploaded_file in uploaded_files:
        suffix = Path(uploaded_file.name).suffix.lower()
        if suffix not in ALLOWED_IMAGE_EXTENSIONS:
            return Response(
                {
                    "error": (
                        f"Unsupported image type for {uploaded_file.name}. "
                        f"Allowed extensions: "
                        f"{sorted(ALLOWED_IMAGE_EXTENSIONS)}."
                    )
                },
                status=400,
            )
        if uploaded_file.size > MAX_IMAGE_SIZE_BYTES:
            return Response(
                {
                    "error": (
                        f"{uploaded_file.name} exceeds the 25 MB size limit."
                    )
                },
                status=400,
            )
        try:
            uploaded_file.seek(0)
            with Image.open(uploaded_file) as image:
                image.verify()
            uploaded_file.seek(0)
        except (OSError, Image.DecompressionBombError):
            return Response(
                {
                    "error": f"{uploaded_file.name} is not a valid image."
                },
                status=400,
            )

    return None
