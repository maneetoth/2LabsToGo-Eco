import logging
from rest_framework.parsers import MultiPartParser, JSONParser

from rest_framework.decorators import api_view, parser_classes
from rest_framework.parsers import MultiPartParser
from rest_framework.response import Response

from .api_validation import get_marking_values, validate_uploaded_images
from .services import analyze_single_image, extract_single_image, _as_int, _as_list, _as_string

from .utils.clustering import perform_clustering

LOGGER = logging.getLogger(__name__)


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
    print("[INFO] labeling mehtod", labeling_method)
    try:
        perform_clustering(
            model_weights_path=model_weights_path,
            name_of_images=name_of_img_dir,
            dimentions=clustering_dims,
            cluster_file_name=file_name,
            cluster_label_method=labeling_method
        )
        
        return Response(
            {
                "status": "success",
                "message": f"Clustering dashboard generated successfully as {file_name}.html",
                "cluster_file_name": file_name,
                "cluster_url": f"/media/clusters/{file_name}.html",
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