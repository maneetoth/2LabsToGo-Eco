"use client";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeftIcon, ArrowRightIcon } from "@heroicons/react/24/outline"; // Import Heroicons
import axios from 'axios';
import { useDispatch } from "react-redux";
import { fetchBandData } from "../api/extractBandApiSlice";
import { AppDispatch } from "@/lib/store";
import { unwrapResult } from '@reduxjs/toolkit';
import { preprocessingOptions, PreprocessValue } from "@/features/analysis/quantTLC";

import DensitogramGraph from "@/components/charts/DensitogramGraph";
import { PreprocessedOutput } from "@/utils/preprocessing";

const Dashboard: React.FC = () => {
    const [images, setImages] = useState<File[]>([]);
    const [currentIndex, setCurrentIndex] = useState(0);
    const router = useRouter()
    const dispatch = useDispatch<AppDispatch>()

    type DashboardFormData = {
        real_width_mm: string;
        real_height_mm: string;
        crop_bottom_mm: string;
        crop_top_mm: string;
        first_band_mm: string;
        band_spacing_mm: string;
        num_bands: string;
        // dynamically computed; kept as non-negative float string
        estimated_band_width_mm: string;
    };

    const [formData, setFormData] = useState<DashboardFormData>({
        real_width_mm: "200.0",
        real_height_mm: "100.0",
        crop_bottom_mm: "8.0",
        crop_top_mm: "60.0",
        first_band_mm: "16.0",
        band_spacing_mm: "10.5",
        num_bands: "17",
        // dynamically computed; always non-negative
        estimated_band_width_mm: "6",
    });
    // Track if user manually overrides the auto band width
    const [manualBandWidthOverride, setManualBandWidthOverride] = useState(false);
    const [formErrors, setFormErrors] = useState<{ [key: string]: string }>({});
    const [selectedPreprocessing, setSelectedPreprocessing] = useState<PreprocessValue[]>([]);
    const [preprocessedData, setPreprocessedData] = useState<PreprocessedOutput | null>(null);
    const [bandStep, setBandStep] = useState(1);
    const [isLoading, setIsLoading] = useState(false);

        const validateForm = () => {
                const errors: { [key: string]: string } = {};

                if (images.length === 0) {
                        errors.image = "Please select at least one image.";
                }

                const numericKeys: (keyof DashboardFormData)[] = [
                        "real_width_mm",
                        "real_height_mm",
                        "crop_bottom_mm",
                        "crop_top_mm",
                        "first_band_mm",
                        "band_spacing_mm",
                        "num_bands",
                        "estimated_band_width_mm",
                ];

                for (const key of numericKeys) {
                        const raw = String(formData[key] ?? "").trim();
                        if (raw === "") {
                                errors[key] = "This field is required.";
                                continue;
                        }

                        const parsed = Number(raw);
                        if (!Number.isFinite(parsed)) {
                                errors[key] = "Must be a valid number.";
                                continue;
                        }

                        if (parsed < 0) {
                                errors[key] = "Value must be non-negative.";
                                continue;
                        }

                        if (key === "num_bands" && parsed < 1) {
                                errors[key] = "Must be at least 1.";
                                continue;
                        }
                }

                setFormErrors(errors);
                return Object.keys(errors).length === 0;
        };
      


    
    const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    if (event.target.files) {
        const files = Array.from(event.target.files);
        setImages(files);
        setCurrentIndex(0); // Reset to first image

        // Save images to local storage
        files.forEach((file, index) => {
            const reader = new FileReader();
            reader.onloadend = () => {
                const base64String = reader.result as string;
                // Store image data with a unique key
                localStorage.setItem(`chromatogram_image_${index}`, base64String);
            };
            reader.readAsDataURL(file);
        });

        // Store the number of images
        localStorage.setItem('chromatogram_image_count', files.length.toString());
    }
};

// Add this function to load images from local storage on component mount
const loadImagesFromLocalStorage = () => {
    const imageCount = localStorage.getItem('chromatogram_image_count');
    if (imageCount) {
        const count = parseInt(imageCount);
        const loadedImages: File[] = [];
        
        for (let i = 0; i < count; i++) {
            const imageData = localStorage.getItem(`chromatogram_image_${i}`);
            if (imageData) {
                // Convert base64 to File object
                const byteString = atob(imageData.split(',')[1]);
                const mimeString = imageData.split(',')[0].split(':')[1].split(';')[0];
                const ab = new ArrayBuffer(byteString.length);
                const ia = new Uint8Array(ab);
                for (let j = 0; j < byteString.length; j++) {
                    ia[j] = byteString.charCodeAt(j);
                }
                const blob = new Blob([ab], { type: mimeString });
                const file = new File([blob], `image_${i}.jpg`, { type: mimeString });
                loadedImages.push(file);
            }
        }
        setImages(loadedImages);
    }
};

// Add useEffect to load images when component mounts
useEffect(() => {
    loadImagesFromLocalStorage();
}, []);

    const nextImage = () => {
        setCurrentIndex((prevIndex) => (prevIndex + 1) % images.length);
    };

    const prevImage = () => {
        setCurrentIndex((prevIndex) => (prevIndex - 1 + images.length) % images.length);
    };

    const handleQuantTLC = async () => {
        if (!validateForm()) return;
      
        setIsLoading(true);
        const uploadFormData = new FormData();
        uploadFormData.append('image', images[currentIndex]);
      
                (Object.keys(formData) as Array<keyof DashboardFormData>).forEach((key) => {
                        uploadFormData.append(String(key), formData[key]);
                });
      
        try {
          const resultAction = await dispatch(fetchBandData(uploadFormData));
          const response = unwrapResult(resultAction);
      
          if (response) {
            const fullImageUrl = `http://localhost:8000${response.image_url}`;
            
            const queryParams = new URLSearchParams();
            queryParams.append('image', fullImageUrl);
            (Object.keys(formData) as Array<keyof DashboardFormData>).forEach((key) => {
                queryParams.append(String(key), formData[key]);
            });

            router.push(`/analysis/quant?${queryParams.toString()}`);
          }
        } catch (error) {
          console.error('Error uploading image:', error);
        } finally {
          setIsLoading(false);
        }
      };


    // Update: handle input change for each field, with special handling for estimated_band_width_mm
    const handleInputChange = (event: React.ChangeEvent<HTMLInputElement>) => {
        const { name, value } = event.target;
        // Keep raw input (including empty string) so typing/backspacing is natural.
        setFormData((prev: DashboardFormData) => ({
            ...prev,
            [name]: value,
        }) as DashboardFormData);
        if (name === 'estimated_band_width_mm') {
            setManualBandWidthOverride(true);
        }
    };

    // Dynamically compute estimated_band_width_mm when related inputs change unless user overrode it.
    useEffect(() => {
        if (manualBandWidthOverride) return; // respect manual override
        const toNum = (s: string) => {
            const n = Number(s);
            return Number.isFinite(n) ? n : 0;
        };

        const crop_top_mm = toNum(formData.crop_top_mm);
        const first_band_mm = toNum(formData.first_band_mm);
        const band_spacing_mm = toNum(formData.band_spacing_mm);
        const num_bands = toNum(formData.num_bands);
        // Available migration length after first band application
        const available = Math.max(0, crop_top_mm - first_band_mm);
        const totalSpacing = Math.max(0, (num_bands - 1) * band_spacing_mm);
        const rawWidth = available > totalSpacing && num_bands > 0
            ? (available - totalSpacing) / num_bands
            : 0;
        const width = Number.isFinite(rawWidth) && rawWidth > 0 ? Number(rawWidth.toFixed(4)) : 0.0;
        setFormData((prev: DashboardFormData) => ({ ...prev, estimated_band_width_mm: String(width) }));
    }, [formData.crop_top_mm, formData.first_band_mm, formData.band_spacing_mm, formData.num_bands, manualBandWidthOverride]);

    return (
        
        <div className="flex flex-col items-center mt-4 w-full">
            <fieldset className="fieldset p-4">
                <legend className="fieldset-legend text-lg font-semibold">Pick Chromatogram Images</legend>
                <input
                    type="file"
                    className="file-input file-input-bordered w-full max-w-xs"
                    multiple
                    accept="image/*"
                    onChange={handleFileChange}
                />
                {formErrors.image && (
                    <label className="label">
                        <span className="label-text-alt text-error">{formErrors.image}</span>
                    </label>
                )}
            </fieldset>

            {/* Show Image & Form Only If Images Are Selected */}
            {images.length > 0 && (
                <>
                    {/* Image Display with Navigation */}
                    <div className="mt-6 flex items-center gap-4 w-full max-w-4xl">
                        <button 
                            className="btn btn-circle btn-outline" 
                            onClick={prevImage}
                            disabled={images.length < 2}
                        >
                            <ArrowLeftIcon className="h-6 w-6" />
                        </button>

                        {/* Image Container */}
                        <div className="flex justify-center items-center w-full max-w-3xl overflow-x-auto">
                            <img
                                src={URL.createObjectURL(images[currentIndex])}
                                alt={`Selected ${currentIndex}`}
                                className="w-full h-auto max-h-[500px] rounded-lg shadow-lg object-contain"
                            />
                        </div>

                        <button 
                            className="btn btn-circle btn-outline" 
                            onClick={nextImage}
                            disabled={images.length < 2}
                        >
                            <ArrowRightIcon className="h-6 w-6" />
                        </button>
                    </div>

                    {/* Form Section */}
                    <form className="mt-6 grid grid-cols-2 md:grid-cols-3 gap-4 w-full max-w-4xl">
                        <div className="form-control">
                            <label className="label">
                                <span className="label-text">Plate Length (mm)</span>
                            </label>
                            <input
                                type="number"
                                name="real_width_mm"
                                value={formData.real_width_mm}
                                min="0"
                                step="0.01"
                                onChange={handleInputChange}
                                className={`input input-bordered w-full ${formErrors.real_width_mm ? 'input-error' : ''}`}
                            />
                            {formErrors.real_width_mm && (
                                <label className="label">
                                    <span className="label-text-alt text-error">{formErrors.real_width_mm}</span>
                                </label>
                            )}
                        </div>
                        <div className="form-control">
                            <label className="label">
                                <span className="label-text">Plate Width (mm)</span>
                            </label>
                            <input
                                type="number"
                                name="real_height_mm"
                                value={formData.real_height_mm}
                                min="0"
                                step="0.01"
                                onChange={handleInputChange}
                                className={`input input-bordered w-full ${formErrors.real_height_mm? 'input-error' : ''}`}
                            />
                            {formErrors.real_height_mm && (
                                <label className="label">
                                    <span className="label-text-alt text-error">{formErrors.real_height_mm}</span>
                                </label>
                            )}
                        </div>
                        <div className="form-control">
                            <label className="label">
                                <span className="label-text">Distance to Lower Edge</span>
                            </label>
                            <input
                                type="number"
                                name="crop_bottom_mm"
                                value={formData.crop_bottom_mm}
                                min="0"
                                step="0.01"
                                onChange={handleInputChange}
                                className={`input input-bordered w-full ${formErrors.crop_bottom_mm ? 'input-error' : ''}`}
                            />
                            {formErrors.crop_bottom_mm && (
                                <label className="label">
                                    <span className="label-text-alt text-error">{formErrors.crop_bottom_mm}</span>
                                </label>
                            )}
                        </div>
                        <div className="form-control">
                            <label className="label">
                                <span className="label-text">Migration Front[mm]</span>
                            </label>
                            <input
                                type="number"
                                name="crop_top_mm"
                                value={formData.crop_top_mm}
                                min="0"
                                step="0.01"
                                onChange={handleInputChange}
                                className={`input input-bordered w-full ${formErrors.crop_top_mm ? 'input-error' : ''}`}
                            />
                            {formErrors.crop_top_mm && (
                                <label className="label">
                                    <span className="label-text-alt text-error">{formErrors.crop_top_mm}</span>
                                </label>
                            )}
                        </div>
                        <div className="form-control">
                            <label className="label">
                                <span className="label-text">First Application Position (mm)</span>
                            </label>
                            <input
                                type="number"
                                name="first_band_mm"
                                value={formData.first_band_mm}
                                min="0"
                                step="0.01"
                                onChange={handleInputChange}
                                className={`input input-bordered w-full ${formErrors.first_band_mm ? 'input-error' : ''}`}
                            />
                            {formErrors.first_band_mm && (
                                <label className="label">
                                    <span className="label-text-alt text-error">{formErrors.first_band_mm}</span>
                                </label>
                            )}
                        </div>
                        <div className="form-control">
                            <label className="label">
                                <span className="label-text">Distance Between Tracks (mm)</span>
                            </label>
                            <input
                                type="number"
                                name="band_spacing_mm"
                                value={formData.band_spacing_mm}
                                min="0"
                                step="0.01"
                                onChange={handleInputChange}
                                className={`input input-bordered w-full ${formErrors.band_spacing_mm ? 'input-error' : ''}`}
                            />
                            {formErrors.band_spacing_mm && (
                                <label className="label">
                                    <span className="label-text-alt text-error">{formErrors.band_spacing_mm}</span>
                                </label>
                            )}
                        </div>
                        <div className="form-control">
                            <label className="label">
                                <span className="label-text">Number of Bands</span>
                            </label>
                            <input
                                type="number"
                                name="num_bands"
                                value={formData.num_bands}
                                min="0"
                                step="1"
                                onChange={handleInputChange}
                                className={`input input-bordered w-full ${formErrors.num_bands ? 'input-error' : ''}`}
                            />
                            {formErrors.num_bands && (
                                <label className="label">
                                    <span className="label-text-alt text-error">{formErrors.num_bands}</span>
                                </label>
                            )}
                        </div>
                        <div className="form-control">
                            <label className="label">
                                <span className="label-text">Estimated Band Width (mm)</span>
                            </label>
                            <input
                                type="number"
                                name="estimated_band_width_mm"
                                value={formData.estimated_band_width_mm}
                                min={0}
                                step={0.01}
                                onChange={handleInputChange}
                                className={`input input-bordered w-full ${formErrors.estimated_band_width_mm ? 'input-error' : ''}`}
                            />
                            {formErrors.estimated_band_width_mm && (
                                <label className="label">
                                    <span className="label-text-alt text-error">{formErrors.estimated_band_width_mm}</span>
                                </label>
                            )}
                            {!manualBandWidthOverride && (
                                <p className="text-xs text-neutral-500 mt-1">Change value to override.</p>
                            )}
                        </div>
                    </form>

                    {/* Action Buttons */}
                    <div className="flex justify-center gap-4 mt-6">
                        {/* <button className="btn btn-primary">Move to RTLC</button> */}
                        <button 
                            className={`btn btn-secondary ${isLoading ? 'loading' : ''}`} 
                            onClick={handleQuantTLC}
                            disabled={isLoading}
                        >
                            {isLoading ? <><span className="loading loading-spinner loading-lg"></span> Processing...</> : 'Next'}
                        </button>
                    </div>
                </>
            )}
        </div>
    );
};

export default Dashboard;
