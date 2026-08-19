import torchvision.transforms as transforms
import matplotlib.pyplot as plt
import torch
import torchvision.transforms.functional as F
from PIL import Image
def load_image(paths, plot=False, return_gray_scale=False, image_size=(1024, 1024)):
    """
    Loads multiple images into a single batched tensor.
    Args:
        paths(list[str]): list of image paths
        plot(bool): plots the first image into 4 channels
        return_gray_scale(bool): if True, returns grayscale images
        image_size(tuple[int, int]): resize target (height, width)
    return:
        torch.Tensor: tensor with shape (batch, channels, 640, 640)
    """
    preprocess = transforms.Compose([
        transforms.Resize(image_size),        # for SAM model
        transforms.ToTensor()
    ])
    image_tensors = []

    for path in paths:
        image = Image.open(path).convert("RGB")
        img_tensor = preprocess(image)
        if return_gray_scale:
            img_tensor = F.rgb_to_grayscale(img_tensor, num_output_channels=1)
        image_tensors.append(img_tensor)

    if len(image_tensors) == 0:
        raise ValueError("paths must contain at least one image path")

    first_shape = image_tensors[0].shape
    for img_tensor in image_tensors:
        if img_tensor.shape != first_shape:
            raise ValueError(
                "All images must have the same shape to form a batch tensor. "
                f"Found mismatched shape {img_tensor.shape} != {first_shape}"
            )

    batch_tensor = torch.stack(image_tensors, dim=0)

    # plotting the image
    if plot:
        fig, axs = plt.subplots(2, 2)
        rgb_for_plot = preprocess(Image.open(paths[0]).convert("RGB"))
        axs[0, 0].imshow(rgb_for_plot[:3].permute(1, 2, 0))
        axs[0, 0].set_title('RGB image')
        axs[0, 1].imshow(rgb_for_plot[0,:,:], cmap='Reds')
        axs[0, 1].set_title('Red channel')
        axs[1, 0].imshow(rgb_for_plot[1,:,:], cmap='Greens')
        axs[1, 0].set_title('Green channel')
        axs[1, 1].imshow(rgb_for_plot[2,:,:], cmap='Blues')
        axs[1, 1].set_title('Blue channel')
        plt.tight_layout()
        plt.show()
    return batch_tensor



import cv2
import numpy as np
def apply_blur(input_img,blur_type="bilateral", ksize=9, sigma1=5, sigma2=100, sigma3=75):
    """
    this fucntion applies the bluring to the input image.

    Args:
    imgut_img: (numpy.array) gray scale inout image with shape of (1,x,y).
    blur_type: (str) type of blur we want to apply. default: bilateral
    ksize: (int) size of the kernal or neighbourhood
    sigma1: (int) sigma value for guassian blur
    sigma2,sigma3: (int) sigma value for bilateral blur

    return:
    numpy.array
    """

    if blur_type == "bilateral":
        blur_image = cv2.bilateralFilter(np.array(input_img[0]), ksize, sigma2, sigma3)
    elif blur_type == "meidanblur":
        blur_image = cv2.medianBlur(np.array(input_img[0]), ksize)
    elif blur_type == "gaussianblur":
        blur_image = cv2.GaussianBlur(np.array(input_img[0]), (ksize,ksize),sigma1)

    return blur_image


def _safe_float(value, default=0.0):
    return default if value is None else float(value)
def _safe_int(value, default=0):
    return default if value is None else int(value)

def apply_manual_override(manual_values: dict, num_bands: int, first_x: float, edge_cut: float, migration_front: float, spacing: float, band_width: float):
    updated = dict(manual_values)

    num_bands = manual_values["num_bands"]
    first_x= manual_values["first_x"]
    edge_cut = manual_values["edge_cut"]
    migration_front = manual_values["migration_front"]
    spacing = manual_values["spacing"]
    band_width= manual_values["band_width"]

    mask =manual_values["mask"]
    h = int(mask.shape[0])
    image_bottom_y = float(max(0, h - 1))

    nb = max(0, _safe_int(num_bands, 0))
    first_x = _safe_float(first_x, 0.0)
    spacing = max(1.0, _safe_float(spacing, 30.0))
    band_width = max(1.0, _safe_float(band_width, _safe_float(result.get("rectangle_width", 1.0), 1.0)))

    centers = [float(first_x) + i * spacing for i in range(nb)]

    top_y = image_bottom_y - _safe_float(migration_front, 0.0)
    bottom_y = image_bottom_y - _safe_float(edge_cut, 0.0)

    top_y = float(np.clip(top_y, 0, image_bottom_y))
    bottom_y = float(np.clip(bottom_y, 0, image_bottom_y))
    if bottom_y < top_y:
        top_y, bottom_y = bottom_y, top_y

    updated["rectangle_centers_x"] = centers
    updated["global_top_y"] = top_y
    updated["global_bottom_y"] = bottom_y
    updated["rectangle_width"] = band_width

    return updated