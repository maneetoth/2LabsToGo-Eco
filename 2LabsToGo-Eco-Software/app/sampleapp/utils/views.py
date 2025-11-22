from rest_framework.decorators import api_view
from rest_framework.response import Response
import numpy as np
import matplotlib.pyplot as plt
from .utils.read_image import read_image
from .utils.band_positions import Extract_band_positions
from .utils.extract_densitogram import plot_before_preprocessing, densitogram_after_preprocessing
from PIL import Image
from django.http import JsonResponse
from django.conf import settings
import os
import json
from .utils.calibration_curve import *
import base64
from io import BytesIO

@api_view(['POST'])
# why do we use it?
def read_and_process_image(request):
    """
    API to read and process an image.
    Expects an image file in the request.
    """
    image_file = request.FILES.get('image')
    if not image_file:
        return Response({'error': 'No image file provided'}, status=400)
    image = read_image(image_file, height=None, normalize=False, ls_format=False, plot=False, grayscale=False)
    return Response({'message': 'Image processed successfully'})

@api_view(['POST'])
def Raw_densitogram(request):
    """
    API to extract band positions from the image.
    Expects an image file and parameters in the request.
    """
    # Get the uploaded image file
    image_file = request.FILES.get('image')
    if not image_file:
        return JsonResponse({'error': 'No image file provided'}, status=400)
    try:
        image = read_image(image_file)  # numpy array with the shape of (1058, 4715, 3)
    except Exception as e:
        return JsonResponse({'error': f'Error opening image: {str(e)}'}, status=400)
    # Get the parameters from the request body
    params = request.data
    real_width_mm = params.get('real_width_mm') # string
    real_height_mm = params.get('real_height_mm')
    crop_bottom_mm = params.get('crop_bottom_mm')
    crop_top_mm = params.get('crop_top_mm')
    first_band_mm = params.get('first_band_mm')
    band_spacing_mm = params.get('band_spacing_mm')
    num_bands = params.get('num_bands')
    estimated_band_width_mm = params.get('estimated_band_width_mm', None)
    try:
        estimated_band_width_mm= float(estimated_band_width_mm)
    except:
        estimated_band_width_mm=None
    # Validate that all required parameters are provided
    required_params = [
        'real_width_mm', 'real_height_mm', 'crop_bottom_mm', 'crop_top_mm',
        'first_band_mm', 'band_spacing_mm', 'num_bands', 'estimated_band_width_mm'
    ]
    missing_params = [param for param in required_params if params.get(param) is None]
    if missing_params:
        return Response({'error': f'Missing parameters: {", ".join(missing_params)}'}, status=400)
    # Process the image to extract bands
    analyzer = Extract_band_positions(image)
    processed_image = analyzer.process_image(
        real_width_mm=float(real_width_mm),
        real_height_mm=float(real_height_mm),
        crop_bottom_mm=float(crop_bottom_mm),
        crop_top_mm=float(crop_top_mm),
        first_band_mm=float(first_band_mm),
        band_spacing_mm=float(band_spacing_mm),
        num_bands=float(num_bands),
        estimated_band_width_mm=None
    )
    hauteur_val = 100
    Zf_val = 60
    dist_bas_val = 16
    band_data = analyzer.get_band_data_by_number()
    # ALWAYS skip preprocessing (regardless of request content)
    # print('*' * 50)
    # print(band_data[10])
    # # (550, 148, 3)
    # print('*' * 50)
    raw_data = plot_before_preprocessing(
        band_data,
        return_json=True
    )

    # Convert NumPy array to PIL Image if needed
    if isinstance(processed_image, np.ndarray):  
        processed_image = Image.fromarray(processed_image)

    # Save image to BytesIO buffer as PNG
    from io import BytesIO
    import base64


    buffer = BytesIO()
    processed_image.save(buffer, format='PNG')
    buffer.seek(0)
    # Encode image as base64 string
    img_base64 = base64.b64encode(buffer.getvalue()).decode('utf-8')
    # Now you can return it in your API response
    data = json.loads(raw_data)
    
    # print('data:', len(data['17']['red']), len(data['1']['blue']),len(data['10']['green']))
    # image=data['1']['band_image']
    # return JsonResponse({
    #     "marked_image": image
    # })


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
    try:
        # Get input data from the request body (assuming it is JSON)
        input_data = request.data
        # Extract densitogram data, preprocessing steps, and options from the request
        densitogram_data = input_data.get('densitogram_data')
        if isinstance(densitogram_data, str):
            densitogram_data = json.loads(densitogram_data)
        # order of preprocessing
        preprocess_order = input_data.get('preprocess_order', [])
        if len(preprocess_order)==0:
            return JsonResponse({"processed_data": input_data}, safe=False)
        if isinstance(preprocess_order, str):
            preprocess_order = json.loads(preprocess_order)
        # parameters for preprocessing
        preprocess_option = input_data.get('preprocess_option', {})
        if isinstance(preprocess_option, str):
            preprocess_option = json.loads(preprocess_option)
        if not densitogram_data or not preprocess_order:
            return JsonResponse({"error": "Missing required fields"}, status=400)
        # Process the densitogram data
        processed_data = densitogram_after_preprocessing(densitogram_data, preprocess_order, preprocess_option)
        if isinstance(processed_data, str):
            processed_data= json.loads(processed_data)
        # Return the processed data as a JSON response
        return JsonResponse({"processed_data": processed_data}, safe=False)
    except Exception as e:
        return JsonResponse({"error": str(e)}, status=500)
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
    # Fit the model

    data=calibrate_and_predict(known_conc, known_peaks,unknown_peaks,model_type=model_type)
    return JsonResponse(data)
    