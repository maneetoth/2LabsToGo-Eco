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
from .utils.read_image import read_image
from .utils.band_positions import Extract_band_positions
from .utils.extract_densitogram import plot_before_preprocessing, densitogram_after_preprocessing
from .utils.calibration_curve import *


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
        estimated_band_width_mm=estimated_band_width_mm
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
    # data = json.loads(raw_data)
    
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
        return JsonResponse({"error": str(e), "preprocess_option": preprocess_order}, status=500)
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


@api_view(['GET'])
@ensure_csrf_cookie
def csrf(request):
    # returns token and ensures csrftoken cookie is set
    return JsonResponse({'csrfToken': get_token(request)})