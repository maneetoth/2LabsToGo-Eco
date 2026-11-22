import base64
import json
from io import BytesIO

import numpy as np
from PIL import Image
from django.http import JsonResponse
from rest_framework.decorators import api_view
from rest_framework.response import Response

from utils.band_positions import Extract_band_positions
from utils.calibration_curve import calibrate_and_predict
from utils.extract_densitogram import densitogram_after_preprocessing, plot_before_preprocessing
from utils.peak_integration import apply_peak_edits, get_peaks_and_area
from utils.read_image import read_image


@api_view(['POST'])
def read_and_process_image(request):
    """
    API to read and process an image.
    Expects an image file in the request.
    """
    image_file = request.FILES.get("image")
    if not image_file:
        return Response({"error": "Upload an image using the image field."}, status=400)
    try:
        read_image(image_file)
    except (OSError, ValueError) as error:
        return Response({"error": str(error)}, status=400)
    return Response({"message": "Image processed successfully"})


@api_view(['POST'])
def Raw_densitogram(request):
    """
    API to extract band positions from the image.
    Expects an image file and parameters in the request.
    """
    # Basic request validation
    if not request:
        return JsonResponse({'error': 'Empty request.'}, status=400)

    # Get the uploaded image file
    image_file = request.FILES.get('image')

    if not image_file:
        return JsonResponse({'error': 'No image file provided. Upload as multipart file under "image".'}, status=400)
    try:
        image = read_image(image_file)
    except Exception as e:
        return JsonResponse({'error': f'Error opening image: {str(e)}'}, status=400)

    # Get the parameters from the request body
    params = request.data
    if not params:
        return JsonResponse({'error': 'No parameters provided.'}, status=400)
    real_width_mm = params.get('real_width_mm')
    real_height_mm = params.get('real_height_mm')
    crop_bottom_mm = params.get('crop_bottom_mm')
    crop_top_mm = params.get('crop_top_mm')
    first_band_mm = params.get('first_band_mm')
    band_spacing_mm = params.get('band_spacing_mm')
    num_bands = params.get('num_bands')
    estimated_band_width_mm = params.get('estimated_band_width_mm', None)
    try:
        estimated_band_width_mm = float(estimated_band_width_mm) if estimated_band_width_mm is not None else None
    except Exception:
        return JsonResponse({'error': 'estimated_band_width_mm must be a number if provided.'}, status=400)

    # Validate that all required parameters are provided
    required_params = [
        'real_width_mm', 'real_height_mm', 'crop_bottom_mm', 'crop_top_mm',
        'first_band_mm', 'band_spacing_mm', 'num_bands'
    ]
    missing_params = [param for param in required_params if params.get(param) is None]
    if missing_params:
        return Response({'error': f'Missing parameters: {", ".join(missing_params)}'}, status=400)
    # Process the image to extract bands
    try:
        analyzer = Extract_band_positions(image)
        processed_image = analyzer.process_image(
            real_width_mm=float(real_width_mm),
            real_height_mm=float(real_height_mm),
            crop_bottom_mm=float(crop_bottom_mm),
            crop_top_mm=float(crop_top_mm),
            first_band_mm=float(first_band_mm),
            band_spacing_mm=float(band_spacing_mm),
            num_bands=float(num_bands),
            estimated_band_width_mm=estimated_band_width_mm
        )
        band_data = analyzer.get_band_data_by_number()
        raw_data = plot_before_preprocessing(
            band_data,
            return_json=True
        )
    except Exception as e:
        return JsonResponse({type(e).__name__: "unable to process Image please provide correct values"}, status=400)

    # Convert NumPy array to PIL Image if needed
    if isinstance(processed_image, np.ndarray):
        processed_image = Image.fromarray(processed_image)

    # Save image to BytesIO buffer as PNG


    buffer = BytesIO()
    processed_image.save(buffer, format='PNG')
    buffer.seek(0)
    # Encode image as base64 string
    img_base64 = base64.b64encode(buffer.getvalue()).decode('utf-8')

    return JsonResponse({
        "marked_image": img_base64,
        "densitogram_data": raw_data

    })

@api_view(['POST'])
def Processed_densitogram(request):
    """
    API endpoint to process densitogram data after applying preprocessing steps.
    Accepts JSON data with densitogram and preprocessing options.
    """
    input_data = request.data

    try:
        densitogram_data = input_data.get('densitogram_data')
        if densitogram_data is None:
            return JsonResponse({"error": "Missing required field: densitogram_data."}, status=400)

        if isinstance(densitogram_data, str):
            try:
                densitogram_data = json.loads(densitogram_data)
            except json.JSONDecodeError as e:
                return JsonResponse({"error": "densitogram_data is not valid JSON.", "details": str(e)}, status=400)

        preprocess_order = input_data.get('preprocess_order', None)
        if preprocess_order is None:
            return JsonResponse({"error": "Missing required field: preprocess_order."}, status=400)

        if isinstance(preprocess_order, str):
            try:
                preprocess_order = json.loads(preprocess_order)
            except json.JSONDecodeError as e:
                return JsonResponse({"error": "preprocess_order is not valid JSON.", "details": str(e)}, status=400)

        preprocess_option = input_data.get('preprocess_option', {})
        if isinstance(preprocess_option, str):
            try:
                preprocess_option = json.loads(preprocess_option)
            except json.JSONDecodeError as e:
                return JsonResponse({"error": "preprocess_option is not valid JSON.", "details": str(e)}, status=400)

        if not isinstance(preprocess_order, (list, tuple)) or len(preprocess_order) == 0:
            return JsonResponse({"error": "preprocess_order must be a non-empty list."}, status=400)

    except Exception as e:
        # Any unexpected error while loading inputs
        return JsonResponse({"error": "Failed to load input data", "details": str(e)}, status=400)

    # 2) Process the densitogram data (may raise errors)
    try:
        processed_data = densitogram_after_preprocessing(densitogram_data, preprocess_order, preprocess_option)
    except (TypeError, ValueError) as e:
        # Likely caused by incorrect input types/values
        return JsonResponse({"error": "Processing failed due to invalid input or parameters", "details": str(e)}, status=400)
    except Exception as e:
        # Unexpected error during processing
        return JsonResponse({"error": "Internal processing error", "details": str(e)}, status=500)

    # If processing returned a JSON string, try to parse it; otherwise leave as-is
    if isinstance(processed_data, str):
        try:
            processed_data = json.loads(processed_data)
        except json.JSONDecodeError:
            pass

    return JsonResponse({"processed_data": processed_data}, safe=False)

@api_view(['POST'])
def peak_integration(request):
    input_data = request.data

    # Basic presence validation
    if not input_data:
        return JsonResponse({"error": "No input data provided."}, status=400)

    if "processed_data" not in input_data:
        return JsonResponse({"error": "Missing required field: processed_data."}, status=400)
    if "params" not in input_data:
        return JsonResponse({"error": "Missing required field: params."}, status=400)

    # Extract and coerce types (allow JSON strings)
    data = input_data.get("processed_data")
    params = input_data.get("params")

    # If the client sent JSON strings, try to parse them
    if isinstance(data, str):
        try:
            data = json.loads(data)
        except json.JSONDecodeError as e:
            return JsonResponse({"error": "processed_data is not valid JSON.", "details": str(e)}, status=400)
        except Exception as e:
            return JsonResponse({"error": "Unexpected error parsing processed_data.", "details": str(e)}, status=500)

    if isinstance(params, str):
        try:
            params = json.loads(params)
        except json.JSONDecodeError as e:
            return JsonResponse({"error": "params is not valid JSON.", "details": str(e)}, status=400)
        except Exception as e:
            return JsonResponse({"error": "Unexpected error parsing params.", "details": str(e)}, status=500)

    # Validate non-empty structures
    if not data or not isinstance(data, dict):
        return JsonResponse({"error": "processed_data is empty or not an object."}, status=400)
    if not isinstance(params, dict):
        return JsonResponse({"error": "params must be an object/dict."}, status=400)


    min_peak_height = params.get("min_peak_height", None)
    peak_threshold = params.get("peak_threshold", None)
    distance_bw_peaks = params.get("distance_bw_peaks", None)
    peak_prominence = params.get("peak_prominence", None)
    peak_width = params.get("peak_width", None)
    peak_wlen = params.get("peak_wlen", None)
    peak_el_height = params.get("peak_el_height", None)
    peak_plateau_size = params.get("peak_plateau_size", None)
    peak_Min_peak_area = params.get("peak_Min_peak_area", None)
    find_area = params.get("find_area", True)


    edits = params.get("edit_peak_integration", [])
    clear_automatic_tracks = params.get("clear_automatic_tracks", [])
    if not isinstance(edits, list) or not isinstance(clear_automatic_tracks, list):
        return JsonResponse({"error": "Peak edits and track exclusions must be lists."}, status=400)
    if any(not isinstance(track, str) or track not in data for track in clear_automatic_tracks):
        return JsonResponse({"error": "Choose valid tracks when clearing automatic peaks."}, status=400)

    band_dict = {}

    try:
        for band_key, band in data.items():
            band_dict[band_key] = {}
            for channel_name, channel_data in band.items():
                if channel_name not in ["red", "green", "blue", "grayscale"]:
                    continue

                if band_key in clear_automatic_tracks:
                    band_dict[band_key][channel_name] = {}
                    continue

                try:
                    band_peaks = get_peaks_and_area(
                        channel_data,
                        height=min_peak_height,
                        threshold=peak_threshold,
                        distance=distance_bw_peaks,
                        prominence=peak_prominence,
                        width=peak_width,
                        wlen=peak_wlen,
                        rel_height=0.5 if peak_el_height is None else peak_el_height,
                        plateau_size=peak_plateau_size,
                        Min_peak_area=peak_Min_peak_area,
                        find_area=find_area
                    )
                except Exception as e:
                    # If peak detection fails for this channel, return an error indicating which band/channel failed
                    return JsonResponse({"error": "Peak detection failed", "band": band_key, "channel": channel_name, "details": str(e)}, status=400)

                # Convert keys to peak_x for consistency
                band_dict[band_key][channel_name] = {
                    peak["peak_x"]: {**peak, "source": "automatic"} for peak in band_peaks.values()
                }
    except Exception as e:
        return JsonResponse({"error": "Failed during peak detection processing", "details": str(e)}, status=500)


    try:
        apply_peak_edits(data, band_dict, edits)
    except (TypeError, ValueError) as error:
        return JsonResponse({"error": str(error)}, status=400)

    return JsonResponse(band_dict)




@api_view(['POST'])
def calibrate(request):
    """
    Fit calibration curve, predict unknowns, save and return plot.
    Expects JSON with:
      known_conc    : [float]
      known_peaks   : [float]
      unknown_peaks : [float]
      model_type    : 'hill'|'mm_origin'|'mm_intercept'|'linear'|'linear_origin'
    Returns JSON with:
      known_data    : {'concentrations': known_conc, 'peak_areas': known_peaks}
      predictions   : {'concentrations': predicted_conc, 'peak_areas': unknown_peaks, 'equation': equation_str}
      plot_base64   : base64-encoded calibration plot image
    """
    data = request.data
    known_conc    = data.get('known_conc')
    known_peaks   = data.get('known_peaks')
    unknown_peaks = data.get('unknown_peaks')
    model_type    = data.get('model_type', 'hill')

    # Validate inputs
    if not (isinstance(known_conc, list) and isinstance(known_peaks, list)):
        return Response({'error': 'known_conc and known_peaks must be lists.'}, status=400)
    if len(known_conc) != len(known_peaks):
        return Response({'error': 'known_conc and known_peaks must be same length.'}, status=400)
    if not isinstance(unknown_peaks, list):
        return Response({'error': 'unknown_peaks must be a list.'}, status=400)
    try:

        data=calibrate_and_predict(known_conc, known_peaks,unknown_peaks,
        model_type=model_type)
    except (ValueError, TypeError, RuntimeError) as error:
        return JsonResponse({"error": str(error)}, status=400)

    return JsonResponse(data)
