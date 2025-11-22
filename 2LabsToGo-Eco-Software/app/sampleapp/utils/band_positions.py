import numpy as np
from PIL import Image, ImageDraw
from io import BytesIO

class Extract_band_positions:
    def __init__(self, image_array=None):
        """
        Initialize the BandAnalyzer with either an image path or a numpy array.
        """
        if image_array is not None:
            self.image = image_array
        else:
            raise ValueError("Provide the image path to read image function")
        # Initialize attributes
        self.cropped_img = None
        self.band_centers = None
        self.band_starts = None
        self.band_ends = None
        self.bands_dict = None
        self.ratio_w = None
        self.ratio_h = None
        self.original_image_shape = self.image.shape  # Store original image shape

    def calculate_pixel_to_distance(self, real_width_mm, real_height_mm):
        """Calculates the pixel-to-distance ratio for width and height."""
        pixel_width, pixel_height = self.image.shape[1], self.image.shape[0]
        self.ratio_w = real_width_mm / pixel_width
        self.ratio_h = real_height_mm / pixel_height
        return self.ratio_w, self.ratio_h

    def crop_region(self, crop_bottom_mm, crop_top_mm):
        """Crops the image from the bottom and up to a given height in mm."""
        if self.ratio_h is None:
            raise ValueError("Pixel-to-distance ratio not calculated. Call calculate_pixel_to_distance() first.")
        crop_bottom_px = int(crop_bottom_mm / self.ratio_h)
        crop_top_px = int(crop_top_mm / self.ratio_h)
        self.cropped_img = self.image[-crop_top_px:-crop_bottom_px] if crop_bottom_px > 0 else self.image[-crop_top_px:]
        return self.cropped_img

    def extract_band_regions(self, band_starts_px, band_ends_px):
        """
        Extracts the image regions for each band and stores them in a dictionary.
        This version extracts bands from the cropped image, not the original one.
        """
        if self.cropped_img is None:
            raise ValueError("Image not cropped yet. Call crop_region() first.")

        self.bands_dict = {
            'image_shape': self.cropped_img.shape,
            'num_bands': len(band_starts_px),
            'bands': []
        }

        for i, (start, end) in enumerate(zip(band_starts_px, band_ends_px)):
            # Extract band region from the cropped image, spanning the full height
            band_region = self.cropped_img[:, start:end]
            # Convert band_region to PIL Image for easy saving/viewing
            band_image_pil = Image.fromarray(band_region.astype(np.uint8))
            band_info = {
                'band_number': i + 1,  # 1-based indexing
                'start_px': start,
                'end_px': end,
                'width_px': end - start,
                'region_array': band_region,
                'region_image': band_image_pil
            }
            self.bands_dict['bands'].append(band_info)
        return self.bands_dict

    def locate_bands_center_spacing(self, first_band_mm, band_spacing_mm, num_bands, estimated_band_width_mm=None):
        """
        Identifies and marks band locations based on center-to-center spacing.
        Returns a PIL image with bands marked.
        """
        if self.ratio_w is None:
            raise ValueError("Pixel-to-distance ratio not calculated. Call calculate_pixel_to_distance() first.")

        band_spacing_px = int(band_spacing_mm / self.ratio_w)
        first_band_center_px = int(first_band_mm / self.ratio_w)
        band_centers_px = [first_band_center_px + i * band_spacing_px for i in range(int(num_bands))]

        if estimated_band_width_mm is None:
            estimated_band_width_mm = band_spacing_mm * 0.6
            print(f"Estimating band width: {estimated_band_width_mm:.2f} mm")

        band_width_px = int(estimated_band_width_mm / self.ratio_w)
        band_starts_px = [center - band_width_px // 2 for center in band_centers_px]
        band_ends_px = [center + band_width_px // 2 for center in band_centers_px]

        self.bands_dict = self.extract_band_regions(band_starts_px, band_ends_px)

        # Convert cropped_img (numpy) to PIL for drawing
        img_pil = Image.fromarray(self.cropped_img.astype(np.uint8))
        draw = ImageDraw.Draw(img_pil)

        for center, start, end in zip(band_centers_px, band_starts_px, band_ends_px):
            # Draw green borders for the band (start and end)
            draw.line([(start, 0), (start, img_pil.height)], fill="green", width=2)
            draw.line([(end, 0), (end, img_pil.height)], fill="green", width=2)
            draw.rectangle([(start, 0), (end, img_pil.height)], outline="green", width=2)
            # Draw red dashed center line
            draw.line([(center, 0), (center, img_pil.height)], fill="red", width=2)
            # Note: PIL.ImageDraw does not support dashed lines directly.
            # If you want a dashed effect, you would need to implement it manually.

        self.band_centers = band_centers_px
        self.band_starts = band_starts_px
        self.band_ends = band_ends_px

        return img_pil

    def process_image(self, real_width_mm, real_height_mm, crop_bottom_mm, crop_top_mm,
                      first_band_mm, band_spacing_mm, num_bands, estimated_band_width_mm=None):
        """Processes the image and returns band information with center-to-center spacing."""
        if len(self.image.shape) == 4 and self.image.shape[1] == 1 and self.image.shape[3] == 3:
            self.image = np.squeeze(self.image)

        self.calculate_pixel_to_distance(real_width_mm, real_height_mm)
        self.crop_region(crop_bottom_mm, crop_top_mm)

        return self.locate_bands_center_spacing(first_band_mm, band_spacing_mm, num_bands, estimated_band_width_mm)

    def get_bands_dict(self):
        """Returns the complete bands dictionary with all band information."""
        if self.bands_dict is None:
            raise ValueError("Bands not processed yet. Call process_image() first.")
        return self.bands_dict

    def get_band_data(self, band_number):
        """Returns the data for a specific band (1-based indexing)."""
        if self.bands_dict is None:
            raise ValueError("Bands not processed yet. Call process_image() first.")
        if band_number < 1 or band_number > self.bands_dict['num_bands']:
            raise ValueError(f"Band number must be between 1 and {self.bands_dict['num_bands']}")
        return self.bands_dict['bands'][band_number - 1]

    def get_band_data_by_number(self):
        """Returns a dictionary where keys are band numbers and values are band data."""
        if self.bands_dict is None:
            raise ValueError("Bands not processed yet. Call process_image() first.")
        return {band_info['band_number']: band_info for band_info in self.bands_dict['bands']}

    def get_ratio(self):
        return self.ratio_h
