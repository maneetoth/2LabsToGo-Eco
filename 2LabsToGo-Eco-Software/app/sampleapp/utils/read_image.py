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


    for file_path in source:
        img = None  
        try:
            img = imageio.imread(file_path)
        except Exception:

            pass 
        if img is None:
            try:
                img = cv2.imread(file_path, cv2.IMREAD_UNCHANGED)  
                if img is not None:
                    if len(img.shape) == 3:  
                        img = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)  #
            except Exception:
                pass
        if img is None:
            try:
                pil_img = Image.open(source)
                img = np.array(pil_img)  
                if len(img.shape) == 3: 
                    img = cv2.cvtColor(img, cv2.COLOR_RGB2BGR) 
                    img = cv2.cvtColor(img, cv2.COLOR_BGR2RGB) 
                    return img
            except Exception:
                pass
        
        if img is None:
            print(f"Error reading image: {file_path}")

