import numpy as np
import cv2
import imageio.v2 as imageio
from PIL import Image
import matplotlib
import matplotlib.pyplot as plt
matplotlib.use('Agg') 

def read_image(source, height=None, normalize=False, ls_format=False, plot=False, grayscale=False):
    """
    Function to read image files in multiple formats (TIFF, JPEG, PNG, BMP),
    optionally resize, normalize, and display the images.

    Parameters:
        source (str or list): The path(s) of the image file(s).
        height (int, optional): If provided, resizes the image to this height while maintaining aspect ratio.
        normalize (bool, optional): If True, normalizes pixel values to the range [0,1].
        ls_format (bool, optional): If True, returns images in a dictionary format instead of a stacked array.
        plot (bool, optional): If True, displays the image(s) using Matplotlib.
        grayscale (bool, optional): If True, converts image to grayscale.

    Returns:
        np.ndarray or dict: Stacked image array if ls_format is False, otherwise a dictionary of images.
    """
    
    images = {}  # Dictionary to store images with file names as keys

    # Ensure source is a list, even if a single file path is provided
    if isinstance(source, str):
        source = [source]

    # Loop through each file path in the source list
    for file_path in source:
        img = None  # Initialize image variable

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
                print('processing in array')
                pil_img = Image.open(source)
                img = np.array(pil_img)  # Convert PIL image to NumPy array
                if len(img.shape) == 3:  # Only convert if it's a color image
                    img = cv2.cvtColor(img, cv2.COLOR_RGB2BGR)  # Convert to BGR first for consistency
                    img = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)  # Then convert to RGB

                    return img
            except Exception:
                pass

        # If all methods fail, print an error message and continue
        if img is None:
            print(f"Error reading image: {file_path}")
            continue

        # Convert to grayscale if requested
        if grayscale:
            if len(img.shape) == 3:  # Only convert if it's a color image
                img = cv2.cvtColor(img, cv2.COLOR_RGB2GRAY)
            elif len(img.shape) == 2:  # Already grayscale
                pass
            else:
                print(f"Unexpected image shape: {img.shape}")

        # Resize the image while maintaining aspect ratio if height is specified
        if height is not None:
            scale_ratio = height / img.shape[0]  # Compute scaling factor based on height
            new_width = int(img.shape[1] * scale_ratio)  # Compute new width to maintain aspect ratio
            img = cv2.resize(img, (new_width, height), interpolation=cv2.INTER_AREA)  # Resize image using OpenCV

        # Normalize pixel values to the range [0,1] if normalize=True
        if normalize:
            img = img.astype(np.float32) / 255.0  # Convert image to float and scale values

        # Store processed image in the dictionary with filename as key
        images[file_path] = img

    # Plot images if requested
    if plot:
        fig, axes = plt.subplots(1, len(images), figsize=(5 * len(images), 5) ) # Create subplots
        if len(images) == 1:
            axes = [axes]  # Convert single plot to list for consistency
        for ax, (filename, img) in zip(axes, images.items()):
            if len(img.shape) == 2:  # Grayscale image
                ax.imshow(img, cmap='gray')
            else:  # Color image
                ax.imshow(img)
            print(f'Shape : {img.shape}')
            ax.set_title(filename.split("/")[-1])
            ax.axis("off")  # Hide axes
        plt.savefig('first_plot')

    # Return images in the specified format
    if not ls_format:
        stacked_images = np.stack(list(images.values()), axis=0) if images else None
        # Remove singleton dimensions if they exist
        if stacked_images is not None and stacked_images.shape[0] == 1:
            stacked_images = np.squeeze(stacked_images, axis=0)
        return stacked_images
    return images

def main():
    source = '/home/kashif/Desktop/Work/giessen/backend/python/new_code/image_analysis/api/utils/Sugar.jpg'
    read_image(source, height=None, normalize=False, ls_format=False, plot=True)


if __name__ == '__main__':
    main()
