import numpy as np
import cv2
import imageio.v2 as imageio
from PIL import Image
import matplotlib
import matplotlib.pyplot as plt
matplotlib.use('Agg') 

def read_image(source):
    """
    Function to read image files in multiple formats (TIFF, JPEG, PNG, BMP),
    optionally resize, normalize, and display the images.

    Parameters:
        source (str or list): The path(s) of the image file(s).
    Returns:
        np.ndarray : Stacked image array 
    """

    # Loop through each file path in the source list
    for file_path in source:
        img = None  
        # Try reading the image using imageio (supports multiple formats)
        try:
            img = imageio.imread(file_path)
        except Exception:

            pass  # If reading fails, proceed to the next method

        # If imageio fails, try OpenCV (cv2)
        if img is None:
            try:
                img = cv2.imread(file_path, cv2.IMREAD_UNCHANGED)  # Read as is (keeps transparency if applicable)
                if img is not None:
                    if len(img.shape) == 3:  # Only convert if it's a color image
                        img = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)  # Convert BGR to RGB
            except Exception:
                pass
        # If OpenCV fails, try PIL (Pillow)
        if img is None:
            try:
                pil_img = Image.open(source)
                img = np.array(pil_img)  # Convert PIL image to NumPy array
                if len(img.shape) == 3:  # Only convert if it's a color image
                    img = cv2.cvtColor(img, cv2.COLOR_RGB2BGR)  # Convert to BGR first for consistency
                    img = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)  # Then convert to RGB
                    return img
            except Exception:
                pass
        
        if img is None:
            print(f"Error reading image: {file_path}")

