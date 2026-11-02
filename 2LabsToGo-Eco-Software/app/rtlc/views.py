import json
import logging
import os
from pathlib import Path as PyPath
from urllib.parse import quote
from django.conf import settings
from rest_framework.parsers import MultiPartParser, JSONParser

from rest_framework.decorators import api_view, parser_classes
from rest_framework.parsers import MultiPartParser
from rest_framework.response import Response

from .api_validation import get_marking_values, validate_uploaded_images
from .services import analyze_single_image, extract_single_image, _as_int, _as_list, _as_string

from .utils.clustering import nearest_points, perform_clustering

LOGGER = logging.getLogger(__name__)
ALLOWED_BAND_EXTENSIONS = {".png", ".jpg", ".jpeg", ".tif", ".tiff"}


def _extracted_bands_root():
    return PyPath(settings.MEDIA_ROOT) / "extracted_bands"


def _normalise_selected_bands(value):
    if value in (None, ""):
        return {}
    if not isinstance(value, dict):
        raise ValueError("selected_bands must be an object keyed by image folder.")

    normalised = {}
    for folder_name, band_indices in value.items():
        if not isinstance(folder_name, str) or not folder_name.strip():
            raise ValueError("Each selected_bands key must be an image folder name.")
        if not isinstance(band_indices, (list, tuple)):
            raise ValueError("Each selected_bands value must be a list of band indices.")
        try:
            indices = sorted({int(index) for index in band_indices})
        except (TypeError, ValueError):
            raise ValueError(
                "selected_bands must map each image folder to integer band indices."
            )
        if any(index < 1 for index in indices):
            raise ValueError("Band indices must be positive integers.")
        normalised[folder_name] = indices
    return normalised


def _band_files(folder_name):
    root = _extracted_bands_root().resolve()
    folder = (root / folder_name).resolve()
    if folder.parent != root or not folder.is_dir():
        return None
    files = {}
    for path in folder.iterdir():
        if path.is_file() and path.suffix.lower() in ALLOWED_BAND_EXTENSIONS:
            try:
                files[int(path.stem)] = path
            except ValueError:
                continue
    return files


def _band_url(request, folder_name, band_index):
    relative_path = (
        f"{settings.MEDIA_URL.rstrip('/')}/extracted_bands/"
        f"{quote(folder_name)}/{quote(str(band_index))}.png"
    )
    return request.build_absolute_uri(relative_path)


def _load_cluster_points(cluster_name):
    root = (PyPath(settings.MEDIA_ROOT) / "clusters").resolve()
    path = (root / f"{cluster_name}.json").resolve()
    if path.parent != root or not path.is_file():
        return None
    with path.open() as points_file:
        return json.load(points_file)["points"]


def _get_uploaded_files(request):
    uploaded_files = request.FILES.getlist("image")
    if not uploaded_files:
        return None, Response(
            {
                "error": (
                    "No images uploaded. "
                    "Use the 'image' field."
                )
            },
            status=400,
        )

    validation_error = validate_uploaded_images(uploaded_files)
    if validation_error is not None:
        return None, validation_error

    return uploaded_files, None


def _build_results_response(results, errors, total_images):
    response_data = {
        "total_images": total_images,
        "successful": len(results),
        "failed": len(errors),
        "results": results,
    }
    if errors:
        response_data["errors"] = errors

    return Response(
        response_data,
        status=400 if not results else 200,
    )


@api_view(["POST"])
@parser_classes([MultiPartParser])
def analyze_image(request):
    uploaded_files, error_response = _get_uploaded_files(request)
    if error_response is not None:
        return error_response

    marking_values = get_marking_values(request, uploaded_files)
    if isinstance(marking_values, Response):
        return marking_values

    results = []
    errors = []
    for uploaded_file in uploaded_files:
        try:
            results.append(
                analyze_single_image(
                    uploaded_file,
                    request,
                    marking_values=marking_values.get(
                        uploaded_file.name,
                        {},
                    ),
                )
            )
        except Exception:
            LOGGER.exception(
                "Failed to analyze uploaded image %s",
                uploaded_file.name,
            )
            errors.append(
                {
                    "filename": uploaded_file.name,
                    "error": "Unable to analyze image.",
                }
            )

    return _build_results_response(
        results,
        errors,
        total_images=len(uploaded_files),
    )


@api_view(["POST"])
@parser_classes([MultiPartParser])
def extract_bands(request):
    uploaded_files, error_response = _get_uploaded_files(request)
    if error_response is not None:
        return error_response

    marking_values = get_marking_values(request, uploaded_files)
    if isinstance(marking_values, Response):
        return marking_values

    results = []
    errors = []
    for uploaded_file in uploaded_files:
        try:
            results.append(
                extract_single_image(
                    uploaded_file,
                    request,
                    marking_values=marking_values.get(
                        uploaded_file.name,
                        {},
                    ),
                )
            )
        except Exception:
            LOGGER.exception(
                "Failed to extract bands from uploaded image %s",
                uploaded_file.name,
            )
            errors.append(
                {
                    "filename": uploaded_file.name,
                    "error": "Unable to extract bands from image.",
                }
            )

    return _build_results_response(
        results,
        errors,
        total_images=len(uploaded_files),
    )


@api_view(["GET"])
def extracted_bands(request):
    """Return extracted-band metadata for the production frontend."""
    root = _extracted_bands_root()
    results = []
    if root.is_dir():
        for folder in sorted(path for path in root.iterdir() if path.is_dir()):
            bands = _band_files(folder.name) or {}
            results.append(
                {
                    "image_folder": folder.name,
                    "num_bands_extracted": len(bands),
                    "bands": [
                        {
                            "index": index,
                            "filename": path.name,
                            "url": request.build_absolute_uri(
                                f"{settings.MEDIA_URL.rstrip('/')}/"
                                f"extracted_bands/{quote(folder.name)}/{quote(path.name)}"
                            ),
                        }
                        for index, path in sorted(bands.items())
                    ],
                }
            )
    return Response({"results": results, "total_images": len(results)}, status=200)


@api_view(["GET"])
def datapoint(request):
    """Return the source image and band URL represented by one cluster point."""
    folder_name = request.query_params.get("image_folder", "").strip()
    raw_band_index = request.query_params.get("band_index", "")
    if not folder_name or not raw_band_index:
        return Response(
            {"error": "image_folder and band_index are required."},
            status=400,
        )
    try:
        band_index = int(raw_band_index)
    except ValueError:
        return Response({"error": "band_index must be an integer."}, status=400)

    bands = _band_files(folder_name)
    if bands is None or band_index not in bands:
        return Response({"error": "The requested band does not exist."}, status=404)

    band_path = bands[band_index]
    return Response(
        {
            "image_folder": folder_name,
            "band_index": band_index,
            "filename": band_path.name,
            "band_url": request.build_absolute_uri(
                f"{settings.MEDIA_URL.rstrip('/')}/extracted_bands/"
                f"{quote(folder_name)}/{quote(band_path.name)}"
            ),
        },
        status=200,
    )


@api_view(["GET"])
def compare_datapoints(request):
    """Return the band of each manually selected point, or of one point and its nearest points."""
    cluster_name = request.query_params.get("cluster_file_name", "").strip()
    mode = request.query_params.get("mode", "")
    if not cluster_name:
        return Response({"error": "cluster_file_name is required."}, status=400)
    if mode not in ("manual", "nearest"):
        return Response({"error": "mode must be manual or nearest."}, status=400)

    points = _load_cluster_points(cluster_name)
    if points is None:
        return Response({"error": "The requested cluster does not exist."}, status=404)

    try:
        indices = list(
            dict.fromkeys(int(index) for index in request.query_params.getlist("points"))
        )
    except ValueError:
        return Response({"error": "points must be integers."}, status=400)
    if any(index < 0 or index >= len(points) for index in indices):
        return Response({"error": "points contains an unknown datapoint."}, status=400)

    if mode == "manual":
        if len(indices) < 2:
            return Response(
                {"error": "Select at least two datapoints to compare."},
                status=400,
            )
        matches = [(index, None) for index in indices]
    else:
        if len(indices) != 1:
            return Response({"error": "Select exactly one datapoint."}, status=400)
        try:
            n_neighbors = int(request.query_params.get("n_neighbors", ""))
        except ValueError:
            return Response({"error": "n_neighbors must be an integer."}, status=400)
        if n_neighbors < 1:
            return Response({"error": "n_neighbors must be at least 1."}, status=400)
        coordinates = [point["coordinates"] for point in points]
        matches = [(indices[0], 0.0)] + nearest_points(
            coordinates,
            indices[0],
            n_neighbors,
        )

    return Response(
        {
            "mode": mode,
            "datapoints": [
                {**points[index], "index": index, "distance": distance}
                for index, distance in matches
            ],
        },
        status=200,
    )


@api_view(["POST"])
@parser_classes([MultiPartParser, JSONParser])
def make_clusters(request):
    data = request.data  
    model_weights_path = data.get(
        "model_weights_path", 
        "./models/autoencoder_300.pkl"
    )
    name_of_img_dir = _as_list(data.get("name_of_images"))
    clustering_dims = _as_int(data.get("clustering_dimentions"), 3)
    file_name = _as_string(data.get("clustering_file_name"), None)
    labeling_method = _as_string(data.get("label_method"), "kmeans")
    try:
        selected_bands = _normalise_selected_bands(data.get("selected_bands"))
        if selected_bands:
            if not name_of_img_dir:
                raise ValueError(
                    "name_of_images is required when selected_bands is provided."
                )
            requested_folders = set(name_of_img_dir)
            unknown_folders = set(selected_bands) - requested_folders
            if unknown_folders:
                raise ValueError(
                    "selected_bands contains folders not included in name_of_images."
                )
            for folder_name, indices in selected_bands.items():
                bands = _band_files(folder_name)
                if bands is None:
                    raise ValueError(f"Extracted folder does not exist: {folder_name}.")
                unavailable = set(indices) - set(bands)
                if unavailable:
                    raise ValueError(
                        f"Band indices are not available for {folder_name}: "
                        f"{sorted(unavailable)}."
                    )
    except ValueError as error:
        return Response({"error": str(error)}, status=400)
    print("[INFO] labeling mehtod", labeling_method)
    try:
        clustered_band_count, clustered_image_count = perform_clustering(
            model_weights_path=model_weights_path,
            name_of_images=name_of_img_dir,
            dimentions=clustering_dims,
            cluster_file_name=file_name,
            cluster_label_method=labeling_method,
            selected_bands=selected_bands,
        )
        
        return Response(
            {
                "status": "success",
                "message": (
                    f"Clustering dashboard generated successfully as {file_name}.html "
                    f"using {clustered_band_count} selected bands from "
                    f"{clustered_image_count} images. "
                    f"Per-image counts: {', '.join(f'{name}={len(bands)}' for name, bands in selected_bands.items())}."
                ),
                "cluster_file_name": file_name,
                "cluster_url": f"/media/clusters/{file_name}.html",
                "selected_band_counts": {
                    folder_name: len(band_indices)
                    for folder_name, band_indices in selected_bands.items()
                },
            },
            status=200,
        )
        
    except Exception:
        LOGGER.exception("Failed to perform clustering for files.")
        return Response(
            {
                "status": "error",
                "message": "Unable to perform clustering.",
            },
            status=500,
        )


@api_view(["GET"])
def list_models(request):
    """Return a list of available model weight files (.pkl, .pth, .pt) from the models directory."""
    models_dir = PyPath(__file__).resolve().parent.parent / "models"
    allowed_extensions = {".pkl", ".pth", ".pt"}
    models = []

    if models_dir.is_dir():
        for entry in sorted(models_dir.iterdir()):
            if entry.is_file() and entry.suffix.lower() in allowed_extensions:
                models.append({
                    "name": entry.stem,
                    "path": f"./models/{entry.name}",
                })

    return Response({"models": models}, status=200)