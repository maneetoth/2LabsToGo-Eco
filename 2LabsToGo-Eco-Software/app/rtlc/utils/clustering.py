# This file will be used for clustering the bands
import os
import torch
import pandas as pd
import numpy as np
import plotly.express as px
from sklearn.cluster import KMeans
from sklearn.decomposition import PCA
import time
# -- Custom file imports
from .data_preprocessing import get_inference_tensor
from .model import load_model

# -- 1. Inference: Extracting the latent representations
MODEL_WEIGHTS_PATH = "./models/autoencoder_300.pkl"

def get_latent_representation(model, input_tensor):
    with torch.no_grad():
        latents = model.encode(input_tensor).detach().cpu().numpy()
    return latents

def get_labels(num_clusters,image_names, latents,method= "name", random_state =32):
    if method == "name":
        return np.array([name.split("/")[0] for name in image_names])
    else:
        kmeans = KMeans(n_clusters=num_clusters, random_state=random_state)
        labels = kmeans.fit_predict(latents)
        return labels

def pca(latents, dims= 3, random_state=32):
    pca_ = PCA(n_components=dims, random_state=random_state)
    latents_pca = pca_.fit_transform(latents)
    return latents_pca

def get_clusters(latent_pca,labels,image_names,  dims=3, cluster_name = None, output_dir =None ):
    if cluster_name == None:
       cluster_name =time.strftime("%H:%M:%S %Y-%m-%d", time.localtime())
    if dims == 3:
        df = pd.DataFrame({
            'x': latent_pca[:, 0],
            'y': latent_pca[:, 1],
            'z': latent_pca[:, 2],
            'Cluster': labels.astype(str), # Force discrete colors for each group
            "ImageName": image_names
        })
        fig = px.scatter_3d(
            df, x='x', y='y', z='z',
            color='Cluster',
            title="Interactive 3D Latent Space Clusters.",
            hover_name="ImageName",
            opacity=0.8
        )
    elif dims == 2:
        df = pd.DataFrame({
            'x': latent_pca[:, 0],
            'y': latent_pca[:, 1],
            'Cluster': labels.astype(str), # Force discrete colors for each group
            "ImageName": image_names
        })
        fig = px.scatter(
            df, x='x', y='y',
            color='Cluster',
            title="Interactive 2D Latent Space Clusters.",
            hover_name="ImageName",
            opacity=0.8
        )
    # Save as HTML to retain interactivity
    if output_dir == None:
        output_dir = "./media/clusters"
    os.makedirs(output_dir, exist_ok=True)
    fig.write_html(f"{output_dir}/{cluster_name}.html")



# In clustering.py
def perform_clustering(model_weights_path=MODEL_WEIGHTS_PATH,cluster_label_method ="name", name_of_images: list = None, dimentions=3, cluster_file_name=None):
    # 1. Get the data
    input_tensor, image_names, num_clusters = get_inference_tensor(data_folder_path=name_of_images) #[cite: 3]

    if input_tensor is None or num_clusters == 0:
        raise ValueError(
            "No band images found for clustering. Please ensure you have clicked 'Extract Bands' first "
            "and that images exist under ./media/extracted_bands/."
        )

    # 2. Loading the model
    model = load_model(weights_path=model_weights_path) #[cite: 3]

    # 3. Extract latent representation from the model
    latent_model = get_latent_representation(model, input_tensor) #[cite: 3]

    # 4. Get labels using KMeans

    labels = get_labels(num_clusters,image_names, latent_model, method=cluster_label_method) #[cite: 3]

    print("[INFO]", type(labels))
    # 5. Perform PCA
    latent_pca = pca(latent_model, dims=dimentions) #[cite: 3]

    # 6. Generate interactive plot HTML
    get_clusters(latent_pca, labels, image_names, cluster_name=cluster_file_name, dims=dimentions, output_dir=None) #[cite: 3]