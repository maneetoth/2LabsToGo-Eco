# Django imports
from django.views.generic import FormView, View
from django.http import JsonResponse
from django.shortcuts import render
from django.forms.models import model_to_dict
from django.conf import settings
from django.middleware.csrf import get_token
from django.views.decorators.csrf import ensure_csrf_cookie

# Third-party imports
from rest_framework.decorators import api_view
from rest_framework.response import Response
import numpy as np
import matplotlib.pyplot as plt
from PIL import Image, ImageDraw, ImageFont

# Standard library imports
import json
import os
from types import SimpleNamespace

# App-specific imports
from finecontrol.forms import data_validations, data_validations_and_save, Method_Form
from finecontrol.models import Method_Db
from finecontrol.calculations.sampleAppCalc import *
from connection.forms import OC_LAB
from .forms import *
from .models import *
from .utils.band_positions import Extract_band_positions
from .utils.extract_densitogram import plot_before_preprocessing, densitogram_after_preprocessing
from .utils.calibration_curve import *
from .utils.peak_integration import get_peaks_and_area
from io import BytesIO
import base64


class SampleView(FormView):
    def get(self, request):
        """Manage the HTML view in SampleApp"""
        OC_LAB.send(f'M92Z400')
        OC_LAB.send(f'M203Z40') #speed syringe pump  
        OC_LAB.send(f'M42P49S0') #switch motor and endstop
        OC_LAB.send(f'M42P36S0') #valve for AS
        return render(request,'sample.html',{})

class SyringeView(FormView):
    def get(self, request):
        """Manage the HTML view in SampleApp"""
        OC_LAB.send(f'M92Z1600') #syringe pump pitch (400 for autosampler , 2133 for K)
        OC_LAB.send(f'M203Z5') #speed syringe pump  
        OC_LAB.send(f'M42P49S255') #switch motor and endstop
        OC_LAB.send(f'M42P36S255') #valve for SP
        return render(request,'samplesp.html',{})

class SampleDelete(View):

    def delete(self, request, id):
        apps = SampleApplication_Db.objects.filter(method=Method_Db.objects.get(pk=id))
        apps.delete()
        return JsonResponse({})

class SampleDetails(View):

    def delete(self, request, id):
        Method_Db.objects.get(pk=id).delete()
        return JsonResponse({})

    def get(self, request, id):
        """Loads an object specified by ID"""
        id_object = id
        response = {}
        method = Method_Db.objects.get(pk=id_object)
        if not SampleApplication_Db.objects.filter(method=method):
            response.update({"filename":getattr(method,"filename")})
            response.update({"id":id_object})
        else:
            
            sample_config = SampleApplication_Db.objects.get(method=method)
            response.update(model_to_dict(sample_config.pressure_settings.get(), exclude=["id",]))
            response.update(model_to_dict(sample_config.plate_properties.get(), exclude=["id",]))
            response.update(model_to_dict(sample_config.band_settings.get(), exclude=["id",]))
            response.update(model_to_dict(sample_config.zero_properties.get(), exclude=["id",]))
            response.update(model_to_dict(sample_config.movement_settings.get(), exclude=["id",]))
            response.update(model_to_dict(method))

            bands_components = BandsComponents_Db.objects.filter(sample_application=sample_config.id).values()
            response.update({'bands_components': [entry for entry in bands_components]})

        return JsonResponse(response)

    def post(self, request):
        """Save and Update Data"""
        id = request.POST.get("selected-element-id")
        bands_components = json.loads(request.POST.get('table'))
        
        if not id or not SampleApplication_Db.objects.filter(method=Method_Db.objects.get(pk=id)):
            sample_form = SampleApplication_Form(request.POST)
            if sample_form.is_valid():
                sample_instance = sample_form.save(commit=False)
                sample_instance.auth = request.user
                method_form = Method_Form(request.POST)
                
                if not id:
                    method = method_form.save(commit=False)
                    method.auth = request.user
                    method.save()
                else:
                    method = Method_Db.objects.get(pk=id)
                sample_instance.method = method
                sample_instance.save()
                objects_save = data_validations_and_save(
                    plate_properties=PlateProperties_Form(request.POST),
                    pressure_settings=PressureSettings_Form(request.POST),
                    zero_position=ZeroPosition_Form(request.POST),
                    band_settings=BandSettings_Form(request.POST),
                    movement_settings=MovementSettings_Form(request.POST),
                )
                sample_instance.pressure_settings.add(objects_save["pressure_settings"])
                sample_instance.plate_properties.add(objects_save["plate_properties"])
                sample_instance.zero_properties.add(objects_save["zero_position"])
                sample_instance.band_settings.add(objects_save["band_settings"])
                sample_instance.movement_settings.add(objects_save["movement_settings"])
                

        else:
            method = Method_Db.objects.get(pk=id)
            method_form = Method_Form(request.POST, instance=method)
            method_form.save()
            sample_instance = SampleApplication_Db.objects.get(method=method)
            sample_form = SampleApplication_Form(request.POST, instance=sample_instance)
            sample_inst= sample_form.save(commit=False)
            sample_inst.method = method
            sample_inst.save()
            data_validations_and_save(
                    plate_properties=PlateProperties_Form(request.POST,
                                                            instance=sample_instance.plate_properties.get()),
                    pressure_settings=PressureSettings_Form(request.POST,
                                                            instance=sample_instance.pressure_settings.get()),
                    zero_position=ZeroPosition_Form(request.POST,
                                                            instance=sample_instance.zero_properties.get()),
                    band_settings=BandSettings_Form(request.POST,
                                                            instance=sample_instance.band_settings.get()),
                    movement_settings=MovementSettings_Form(request.POST, instance=sample_instance.movement_settings.get()),
                )
            sample_instance.band_components.all().delete()

        for band_component in bands_components:
            band_component_form = BandsComponents_Form(band_component)
            if band_component_form.is_valid():
                band_component_object = band_component_form.save()
                sample_instance.band_components.add(band_component_object)

        return JsonResponse({'message':'Data !!'})

class SampleAppPlay(View):
    def post(self, request):
        # Run the form validations and return the clean data
        forms_data = data_validations(
            plate_properties=PlateProperties_Form(request.POST),
            pressure_settings=PressureSettings_Form(request.POST),
            zero_position=ZeroPosition_Form(request.POST),
            band_settings=BandSettings_Form(request.POST),
            movement_settings=MovementSettings_Form(request.POST)
        )

        bands_components = json.loads(request.POST.get('table'))
        forms_data.update({'table': bands_components})

        # With the data, gcode is generated
        gcode = calculate(forms_data)

        # Printrun
        OC_LAB.print_from_list(gcode)
        return JsonResponse({'error':'f.errors'})

class CalcVol(View):
    def post(self, request):
        forms_data = data_validations(
            plate_properties_form=PlateProperties_Form(request.POST),
            band_settings_form=BandSettings_Form(request.POST),
            movement_settings_form=MovementSettings_Form(request.POST),
            pressure_settings_form=PressureSettings_Form(request.POST),
            zero_position_form=ZeroPosition_Form(request.POST)
        )

        try:
            table_json = request.POST.get('table', '{}') 
            table_data = json.loads(table_json)
            forms_data['table'] = table_data  
        except json.JSONDecodeError as e:
            return JsonResponse({'error': 'Invalid JSON data'}, status=400)

        try:
            data = SimpleNamespace(**forms_data)
            results = calculate_volume_application_infoAS(data)
            return JsonResponse({'results': results})
        except TypeError as e:
            return JsonResponse({'error': str(e)}, status=500)

class SampleDeleteSP(View):

    def delete(self, request, id):
        apps = SampleApplication_Db.objects.filter(method=Method_Db.objects.get(pk=id))
        apps.delete()
        return JsonResponse({})

class SampleDetailsSP(View):

    def delete(self, request, id):
        Method_Db.objects.get(pk=id).delete()
        return JsonResponse({})

    def get(self, request, id):
        """Loads an object specified by ID"""
        id_object = id
        response = {}
        method = Method_Db.objects.get(pk=id_object)
        if not SampleApplication_Db.objects.filter(method=method):
            response.update({"filename":getattr(method,"filename")})
            response.update({"id":id_object})
        else:
            
            sample_config = SampleApplication_Db.objects.get(method=method)
            response.update(model_to_dict(sample_config.pressure_settings.get(), exclude=["id",]))
            response.update(model_to_dict(sample_config.plate_properties.get(), exclude=["id",]))
            response.update(model_to_dict(sample_config.band_settings.get(), exclude=["id",]))
            response.update(model_to_dict(sample_config.zero_properties.get(), exclude=["id",]))
            response.update(model_to_dict(sample_config.movement_settings.get(), exclude=["id",]))
            response.update(model_to_dict(method))

            bands_components = BandsComponents_Db.objects.filter(sample_application=sample_config.id).values()
            response.update({'bands_components': [entry for entry in bands_components]})

        return JsonResponse(response)

    def post(self, request):
        """Save and Update Data"""
        id = request.POST.get("selected-element-id")
        bands_components = json.loads(request.POST.get('table'))
        
        if not id or not SampleApplication_Db.objects.filter(method=Method_Db.objects.get(pk=id)):
            sample_form = SampleApplication_Form(request.POST)
            if sample_form.is_valid():
                sample_instance = sample_form.save(commit=False)
                sample_instance.auth = request.user
                method_form = Method_Form(request.POST)
                
                if not id:
                    method = method_form.save(commit=False)
                    method.auth = request.user
                    method.save()
                else:
                    method = Method_Db.objects.get(pk=id)
                sample_instance.method = method
                sample_instance.save()
                objects_save = data_validations_and_save(
                    plate_properties=PlateProperties_Form(request.POST),
                    pressure_settings=PressureSettings_Form(request.POST),
                    zero_position=ZeroPosition_Form(request.POST),
                    band_settings=BandSettings_Form(request.POST),
                    movement_settings=MovementSettings_Form(request.POST),
                )
                sample_instance.pressure_settings.add(objects_save["pressure_settings"])
                sample_instance.plate_properties.add(objects_save["plate_properties"])
                sample_instance.zero_properties.add(objects_save["zero_position"])
                sample_instance.band_settings.add(objects_save["band_settings"])
                sample_instance.movement_settings.add(objects_save["movement_settings"])
                

        else:
            method = Method_Db.objects.get(pk=id)
            method_form = Method_Form(request.POST, instance=method)
            method_form.save()
            sample_instance = SampleApplication_Db.objects.get(method=method)
            sample_form = SampleApplication_Form(request.POST, instance=sample_instance)
            sample_inst= sample_form.save(commit=False)
            sample_inst.method = method
            sample_inst.save()
            data_validations_and_save(
                    plate_properties=PlateProperties_Form(request.POST,
                                                            instance=sample_instance.plate_properties.get()),
                    pressure_settings=PressureSettings_Form(request.POST,
                                                            instance=sample_instance.pressure_settings.get()),
                    zero_position=ZeroPosition_Form(request.POST,
                                                            instance=sample_instance.zero_properties.get()),
                    band_settings=BandSettings_Form(request.POST,
                                                            instance=sample_instance.band_settings.get()),
                    movement_settings=MovementSettings_Form(request.POST, instance=sample_instance.movement_settings.get()),
                )
            sample_instance.band_components.all().delete()

        for band_component in bands_components:
            band_component_form = BandsComponents_Form(band_component)
            if band_component_form.is_valid():
                band_component_object = band_component_form.save()
                sample_instance.band_components.add(band_component_object)

        return JsonResponse({'message':'Data !!'})

class SampleAppPlaySP(View):
    def post(self, request):
        # Run the form validations and return the clean data
        forms_data = data_validations(
            plate_properties=PlateProperties_Form(request.POST),
            pressure_settings=PressureSettings_Form(request.POST),
            zero_position=ZeroPosition_Form(request.POST),
            band_settings=BandSettings_Form(request.POST),
            movement_settings=MovementSettings_Form(request.POST)
        )

        bands_components = json.loads(request.POST.get('table'))
        forms_data.update({'table': bands_components})

        # With the data, gcode is generated
        gcode = calculatesp(forms_data)

        # Printrun
        OC_LAB.print_from_list(gcode)
        return JsonResponse({'error':'f.errors'})


class CalcVolSP(View):
    def post(self, request):
        forms_data = data_validations(  plate_properties_form    =   PlateProperties_Form(request.POST),
                                        band_settings_form       =   BandSettings_Form(request.POST),
                                        movement_settings_form   =   MovementSettings_Form(request.POST),
                                        pressure_settings_form   =   PressureSettings_Form(request.POST),
                                        zero_position_form       =   ZeroPosition_Form(request.POST))
        forms_data.update({'table':json.loads(request.POST.get('table'))})
        data = SimpleNamespace(**forms_data)
        results = calculate_volume_application_info(data)
        return JsonResponse({'results':results})



# Qant TLC 
@api_view(['POST'])
def read_and_process_image(request):
    """
    API to read and process an image.
    Expects an image file in the request.
    """
    if not request:
        return Response({'error': 'Empty request.'}, status=400)
    
    image_file = request.FILES.get('image')

    if not image_file:
        # allow base64 in JSON under 'image' key
        image_str = request.data.get('image') if request.data else None
        if not image_str:
            return Response({'error': 'No image provided. Send multipart file under "image" or base64 string under "image" in JSON.'}, status=400)
        image_input = image_str
    else:
        image_input = image_file

    try:
        image = read_image(image_input, height=None, normalize=False, ls_format=False, plot=False, grayscale=False)
    except Exception as e:
        return Response({'error': 'Error processing image', 'details': str(e)}, status=400)

    return Response({'message': 'Image processed successfully'})

from .utils.read_image import read_image
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

    # ------------------------
    # 1. Peak detection params
    # ------------------------
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

    # ------------------------
    # 2. Peak edits list
    # ------------------------
    edit_peak_integration = params.get("edit_peak_integration", [])

    band_dict = {}

    # ------------------------
    # 3. Automatic peak detection
    # ------------------------
    try:
        for band_key, band in data.items():
            band_dict[band_key] = {}
            for channel_name, channel_data in band.items():
                if channel_name not in ["red", "green", "blue", "grayscale"]:
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
                        rel_height=peak_el_height,
                        plateau_size=peak_plateau_size,
                        Min_peak_area=peak_Min_peak_area,
                        find_area=find_area
                    )
                except Exception as e:
                    # If peak detection fails for this channel, return an error indicating which band/channel failed
                    return JsonResponse({"error": "Peak detection failed", "band": band_key, "channel": channel_name, "details": str(e)}, status=400)

                # Convert keys to peak_x for consistency
                band_dict[band_key][channel_name] = {
                    v["peak_x"]: v for k, v in band_peaks.items()
                }
    except Exception as e:
        return JsonResponse({"error": "Failed during peak detection processing", "details": str(e)}, status=500)

    # ------------------------
    # 4. Apply manual edits
    # ------------------------
    for edit in edit_peak_integration:
        band_key = edit.get("band_key")
        channel_name = edit.get("channel_name")
        edit_type = edit.get("edit_type", "update").lower()  # "add", "update", "delete"
        new_start = edit.get("new_start")
        new_end = edit.get("new_end")
        manual_peak_height = edit.get("peak_height", None)
        manual_peak_x = edit.get("peak_x", None)

        # Validate band and channel
        if band_key is None or channel_name is None:
            continue
        if band_key not in data or channel_name not in data[band_key]:
            continue

        # Initialize channel dict if missing
        if band_key not in band_dict:
            band_dict[band_key] = {}
        if channel_name not in band_dict[band_key]:
            band_dict[band_key][channel_name] = {}

        x = np.array(data[band_key][channel_name])
        t = np.arange(len(x))

        # For add/update, need bounds
        if edit_type in ["add", "update"] and (new_start is None or new_end is None):
            continue

        # ------------------------
        # Compute peak_x for add or if not provided
        # ------------------------
        if edit_type == "add":
            manual_peak_x = int(new_start + np.argmax(x[new_start:new_end]))
        elif manual_peak_x is None:
            # For update, user must provide peak_x
            continue

        dict_key = manual_peak_x  # Use peak_x as dictionary key

        # ------------------------
        # DELETE
        # ------------------------
        if edit_type == "delete":
            # deletion will be applied later in final filtering
            continue

        # ------------------------
        # Compute area and peak height if not provided
        # ------------------------
        try:
            area_val = float(np.trapz(x[new_start:new_end+1], t[new_start:new_end+1]))
            if manual_peak_height is None:
                manual_peak_height = float(x[new_start:new_end].max())
        except Exception as e:
            # Skip this edit if bounds/indices are invalid or computation fails
            continue

        # ------------------------
        # UPDATE
        # ------------------------
        if edit_type == "update":
            if dict_key in band_dict[band_key][channel_name]:
                band_dict[band_key][channel_name][dict_key] = {
                    "peak_height": float(manual_peak_height),
                    "peak_x": int(manual_peak_x),
                    "start_end": (int(new_start), int(new_end)),
                    "area": area_val
                }
            else:
                # Treat as add if peak does not exist
                edit_type = "add"

        # ------------------------
        # ADD
        # ------------------------
        if edit_type == "add":
            band_dict[band_key][channel_name][dict_key] = {
                "peak_height": float(manual_peak_height),
                "peak_x": int(manual_peak_x),
                "start_end": (int(new_start), int(new_end)),
                "area": area_val
            }

    # ------------------------
    # 5. Final filtering to remove deleted peaks
    # ------------------------
    for edit in edit_peak_integration:
        if edit.get("edit_type", "").lower() == "delete":
            band_key = edit.get("band_key")
            channel_name = edit.get("channel_name")
            peak_x = edit.get("peak_x")
            if band_key and channel_name and peak_x is not None:
                if band_key in band_dict and channel_name in band_dict[band_key]:
                    band_dict[band_key][channel_name].pop(peak_x, None)

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
    except Exception as e:
        return JsonResponse({"error": str(e)}, status=500)

    return JsonResponse(data)


@api_view(['GET'])
@ensure_csrf_cookie
def csrf(request):
    # returns token and ensures csrftoken cookie is set
    return JsonResponse({'csrfToken': get_token(request)})