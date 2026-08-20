import os
import torch
from PIL import Image
import torchvision.transforms as T

def get_inference_tensor(data_folder_path=None):
    """
    Scans either a list of specific folder names (automatically prefixed with 
    the base path) or a default parent directory, transforms the images, 
    and returns a single stacked input tensor, a list of image names, and the count of directories.
    """
    allowed_extensions = [".png", ".jpg", ".jpeg", ".tif", ".tiff"]
    transform = T.Compose([
        T.Resize((512, 128)),
        T.ToTensor()
    ])
    
    image_tensors = []
    image_names = []  # List to track the names/paths
    base_dir = "./media/extracted_bands"
    # Check if data_folder_path is a list of subfolder names or a single path string
    if isinstance(data_folder_path, list) and len(data_folder_path) > 0:
        folder_paths = [os.path.join(base_dir, name) for name in data_folder_path]
        num_dirs = len(folder_paths)
    elif data_folder_path is None or len(data_folder_path) == 0:
        # Default behavior: no specific folders given, so scan the parent
        # directory and use every subfolder found under it.
        if not os.path.exists(base_dir):
            print(f"Error: The path {base_dir} does not exist.")
            return None, None, None
        
        sub_dirs = [d for d in os.listdir(base_dir) if os.path.isdir(os.path.join(base_dir, d))]
        folder_paths = [os.path.join(base_dir, d) for d in sub_dirs]
        num_dirs = len(sub_dirs)
        
    for folder_path in folder_paths:
        # Extract folder name for clean labeling in hover tooltips
        dir_name = os.path.basename(os.path.normpath(folder_path))
        
        if not os.path.exists(folder_path):
            print(f"Warning: Folder path {folder_path} does not exist. Skipping.")
            continue
            
        for file_name in os.listdir(folder_path):
            if any(file_name.lower().endswith(ext) for ext in allowed_extensions):
                img_path = os.path.join(folder_path, file_name)
                
                try:
                    image_pil = Image.open(img_path).convert("RGB")
                    tensor = transform(image_pil)
                    
                    image_tensors.append(tensor)
                    # Save a clean identifier (folder/filename) for the hover label
                    image_names.append(os.path.join(dir_name, file_name))
                except Exception as e:
                    print(f"Could not load image {img_path}: {e}")

    if image_tensors:
        input_tensor = torch.stack(image_tensors)
        print(f"Successfully created tensor with shape: {input_tensor.shape}")
        return input_tensor, image_names, num_dirs
    else:
        print("No valid images found in the specified directories.")
        return None, None, None