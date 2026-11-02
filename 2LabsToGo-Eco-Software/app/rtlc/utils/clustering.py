# This file will be used for clustering the bands
import json
import os
import torch
import pandas as pd
import numpy as np
import plotly.express as px
from sklearn.cluster import KMeans
from sklearn.decomposition import PCA
import time
from urllib.parse import quote
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

def get_clusters(
    latent_pca,
    labels,
    image_names,
    dims=3,
    cluster_name=None,
    output_dir=None,
):
    if cluster_name == None:
       cluster_name =time.strftime("%H:%M:%S %Y-%m-%d", time.localtime())
    source_images = [name.split("/", 1)[0] for name in image_names]
    image_urls = [
        "/media/extracted_bands/"
        + "/".join(quote(part) for part in name.replace("\\", "/").split("/"))
        for name in image_names
    ]
    post_script = """
const CLUSTER_NAME = __CLUSTER_NAME__;
const COMPARE_URL = '/api/rtlc/compare_datapoints/';
const graph = document.getElementById('{plot_id}');
const selected = new Map();
const embedded = new URLSearchParams(window.location.search).has('shiny');
let mode = 'view';

function postSelection() {
    if (!embedded) return;
    window.parent.postMessage(
        {type: 'rtlc-selection', names: Array.from(selected.values())}, '*'
    );
}

function openModal(content) {
    const modal = document.createElement('div');
    modal.style.cssText = [
        'position:fixed', 'inset:0', 'z-index:9999', 'display:flex',
        'align-items:center', 'justify-content:center',
        'background:rgba(0,0,0,.75)', 'padding:24px'
    ].join(';');
    content.style.position = 'relative';
    content.style.maxWidth = '90vw';
    content.style.maxHeight = '90vh';
    content.style.background = '#fff';
    content.style.padding = '16px';
    content.style.borderRadius = '6px';
    content.style.textAlign = 'center';
    const close = document.createElement('button');
    close.textContent = 'Close';
    close.setAttribute('aria-label', 'Close preview');
    close.style.cssText = 'position:absolute;right:8px;top:8px;z-index:1';
    close.onclick = () => modal.remove();
    content.appendChild(close);
    modal.appendChild(content);
    modal.onclick = (event) => {
        if (event.target === modal) modal.remove();
    };
    document.body.appendChild(modal);
}

function showImage(imageUrl, imageName) {
    const content = document.createElement('div');
    const link = document.createElement('a');
    link.href = imageUrl;
    link.target = '_blank';
    link.rel = 'noopener';
    link.title = 'Open image in a new window';
    const image = document.createElement('img');
    image.src = imageUrl;
    image.alt = imageName;
    image.style.cssText = 'display:block;max-width:85vw;max-height:80vh;object-fit:contain';
    const caption = document.createElement('div');
    caption.textContent = imageName + ' (click image to open full size)';
    caption.style.cssText = 'margin-top:8px;word-break:break-word';
    link.appendChild(image);
    content.append(link, caption);
    openModal(content);
}

function showComparison(data) {
    const content = document.createElement('div');
    const title = document.createElement('h3');
    title.textContent = data.mode === 'nearest'
        ? 'Nearest ' + (data.datapoints.length - 1) + ' datapoints'
        : 'Comparing ' + data.datapoints.length + ' datapoints';
    title.style.cssText = 'margin:0 64px 12px;font-family:sans-serif';
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;gap:12px;overflow-x:auto;padding-bottom:8px';
    data.datapoints.forEach((datapoint, position) => {
        const card = document.createElement('div');
        card.style.cssText = 'flex:0 0 auto;width:160px;font:12px sans-serif';
        const image = document.createElement('img');
        image.src = datapoint.image_url;
        image.alt = datapoint.image_name;
        image.style.cssText = 'display:block;width:100%;height:60vh;object-fit:contain;background:#eee';
        const name = document.createElement('div');
        name.textContent = datapoint.image_name;
        name.style.cssText = 'margin-top:6px;word-break:break-word';
        const details = document.createElement('div');
        details.style.color = '#555';
        details.textContent = 'Cluster ' + datapoint.cluster;
        if (data.mode === 'nearest') {
            details.textContent += position === 0
                ? ' · selected'
                : ' · distance ' + datapoint.distance.toFixed(3);
        }
        card.append(image, name, details);
        row.appendChild(card);
    });
    content.append(title, row);
    openModal(content);
}

const toolbar = document.createElement('div');
toolbar.style.cssText = [
    'position:fixed', 'left:12px', 'bottom:12px', 'z-index:1000',
    'display:flex', 'flex-wrap:wrap', 'align-items:center', 'gap:8px',
    'max-width:calc(100vw - 24px)', 'padding:8px 10px',
    'background:rgba(255,255,255,.95)', 'border:1px solid #ccc',
    'border-radius:6px', 'font:13px sans-serif'
].join(';');
const modeSelect = document.createElement('select');
modeSelect.setAttribute('aria-label', 'Click action');
[['view', 'View image'], ['manual', 'Manual selection'], ['nearest', 'Nearest selection']]
    .forEach(([value, label]) => modeSelect.add(new Option(label, value)));
const neighborsLabel = document.createElement('label');
neighborsLabel.textContent = 'Neighbours ';
const neighborsInput = document.createElement('input');
neighborsInput.type = 'number';
neighborsInput.min = '1';
neighborsInput.value = '5';
neighborsInput.style.width = '56px';
neighborsLabel.appendChild(neighborsInput);
const compareButton = document.createElement('button');
compareButton.textContent = 'Compare';
const clearButton = document.createElement('button');
clearButton.textContent = 'Clear';
const status = document.createElement('span');
toolbar.append(modeSelect, neighborsLabel, compareButton, clearButton, status);
document.body.appendChild(toolbar);

function refreshToolbar(message) {
    const needed = mode === 'manual' ? 2 : 1;
    const active = mode !== 'view';
    neighborsLabel.style.display = mode === 'nearest' ? '' : 'none';
    compareButton.style.display = active ? '' : 'none';
    clearButton.style.display = active ? '' : 'none';
    compareButton.disabled = selected.size < needed;
    if (message !== undefined) {
        status.textContent = message;
    } else if (!active) {
        status.textContent = 'Click a point to open its band';
    } else if (selected.size === 0) {
        status.textContent = mode === 'manual'
            ? 'Click points to select them'
            : 'Click a point';
    } else {
        status.textContent = selected.size + ' selected';
    }
}

function clearSelection() {
    selected.clear();
    refreshToolbar();
    postSelection();
}

modeSelect.onchange = () => {
    mode = modeSelect.value;
    clearSelection();
};
clearButton.onclick = clearSelection;
compareButton.onclick = () => compare(neighborsInput.value);

function reportError(message) {
    refreshToolbar(message);
    if (embedded) window.parent.postMessage({type: 'rtlc-error', error: message}, '*');
}

async function compare(nNeighbors) {
    const params = new URLSearchParams({cluster_file_name: CLUSTER_NAME, mode});
    selected.forEach((_, index) => params.append('points', index));
    if (mode === 'nearest') params.set('n_neighbors', nNeighbors);
    compareButton.disabled = true;
    refreshToolbar('Loading…');
    try {
        const response = await fetch(COMPARE_URL + '?' + params);
        const data = await response.json();
        if (!response.ok) {
            reportError(data.error || 'Unable to compare datapoints.');
            return;
        }
        refreshToolbar();
        if (!embedded) {
            showComparison(data);
            return;
        }
        data.datapoints.forEach((datapoint) => {
            datapoint.image_url = new URL(datapoint.image_url, window.location.href).href;
        });
        window.parent.postMessage({type: 'rtlc-comparison', data}, '*');
    } catch (error) {
        reportError('Unable to compare datapoints.');
    }
}

graph.on('plotly_click', function(eventData) {
    const point = eventData.points[0];
    const index = point.customdata[3];
    if (mode === 'view') {
        showImage(point.customdata[0], point.customdata[1]);
        return;
    }
    if (mode === 'nearest') selected.clear();
    if (mode === 'manual' && selected.has(index)) {
        selected.delete(index);
    } else {
        selected.set(index, point.customdata[1]);
    }
    refreshToolbar();
    postSelection();
});
refreshToolbar();

if (embedded) {
    toolbar.style.display = 'none';
    window.addEventListener('message', (event) => {
        if (event.source !== window.parent) return;
        if (!event.data) return;
        if (event.data.type === 'rtlc-compare') compare(event.data.n_neighbors);
        if (event.data.type === 'rtlc-mode') {
            mode = event.data.mode;
            modeSelect.value = mode;
            clearSelection();
        }
    });
    window.parent.postMessage({type: 'rtlc-ready'}, '*');
}
""".replace(
        "__CLUSTER_NAME__",
        json.dumps(cluster_name).replace("<", "\\u003c"),
    )
    if dims == 3:
        df = pd.DataFrame({
            'x': latent_pca[:, 0],
            'y': latent_pca[:, 1],
            'z': latent_pca[:, 2],
            'Cluster': labels.astype(str), # Force discrete colors for each group
            "ImageName": image_names,
            "SourceImage": source_images,
            "ImageURL": image_urls,
            "PointIndex": range(len(image_names)),
        })
        fig = px.scatter_3d(
            df, x='x', y='y', z='z',
            color='SourceImage',
            custom_data=["ImageURL", "ImageName", "Cluster", "PointIndex"],
            title="Interactive 3D Latent Space Clusters (colored by image).",
            hover_name="ImageName",
            opacity=0.8
        )
    elif dims == 2:
        df = pd.DataFrame({
            'x': latent_pca[:, 0],
            'y': latent_pca[:, 1],
            'Cluster': labels.astype(str), # Force discrete colors for each group
            "ImageName": image_names,
            "SourceImage": source_images,
            "ImageURL": image_urls,
            "PointIndex": range(len(image_names)),
        })
        fig = px.scatter(
            df, x='x', y='y',
            color='SourceImage',
            custom_data=["ImageURL", "ImageName", "Cluster", "PointIndex"],
            title="Interactive 2D Latent Space Clusters (colored by image).",
            hover_name="ImageName",
            opacity=0.8
        )
    # Save as HTML to retain interactivity
    if output_dir == None:
        output_dir = "./media/clusters"
    os.makedirs(output_dir, exist_ok=True)
    with open(f"{output_dir}/{cluster_name}.json", "w") as points_file:
        json.dump(
            {
                "dimensions": dims,
                "points": [
                    {
                        "image_name": image_name,
                        "image_url": image_url,
                        "cluster": str(label),
                        "coordinates": coordinates,
                    }
                    for image_name, image_url, label, coordinates in zip(
                        image_names, image_urls, labels, latent_pca.tolist()
                    )
                ],
            },
            points_file,
        )
    fig.write_html(
        f"{output_dir}/{cluster_name}.html",
        post_script=post_script,
    )



def nearest_points(coordinates, point_index, n_neighbors):
    """Return (index, distance) of the closest plotted points, nearest first."""
    coordinates = np.asarray(coordinates, dtype=float)
    distances = np.linalg.norm(coordinates - coordinates[point_index], axis=1)
    order = [
        index
        for index in np.argsort(distances, kind="stable").tolist()
        if index != point_index
    ]
    return [(index, float(distances[index])) for index in order[:n_neighbors]]


# In clustering.py
def perform_clustering(
    model_weights_path=MODEL_WEIGHTS_PATH,
    cluster_label_method="name",
    name_of_images: list = None,
    dimentions=3,
    cluster_file_name=None,
    selected_bands=None,
):
    # 1. Get the data
    input_tensor, image_names, num_clusters = get_inference_tensor(
        data_folder_path=name_of_images,
        selected_bands=selected_bands,
    )

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
    get_clusters(
        latent_pca,
        labels,
        image_names,
        cluster_name=cluster_file_name,
        dims=dimentions,
        output_dir=None,
    )
    return len(image_names), len(set(name.split("/", 1)[0] for name in image_names))