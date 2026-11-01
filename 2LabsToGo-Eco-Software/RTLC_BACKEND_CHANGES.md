# RTLC Frontend Integration Guide

## Overview

RTLC band selection and clustering support is handled by the Django backend.
The Shiny [`app.py`](app/rtlc/app.py) file remains a check/prototype
application and is not required by the production frontend.

The production frontend should:

1. Upload images for analysis and band extraction.
2. Store the returned extracted-folder name for each image.
3. Load the available bands for each extracted image.
4. Maintain selected band indices per image.
5. Submit all selected bands in one clustering request.
6. Display the returned cluster dashboard.

## APIs

All paths are relative to the Django server base URL.

### Analyze images

```http
POST /api/rtlc/analyze_image/
Content-Type: multipart/form-data
```

Send one or more files using the field name `image`.

### Extract bands

```http
POST /api/rtlc/extract_bands/
Content-Type: multipart/form-data
```

Send one or more files using the field name `image`. The response contains one
result per successfully processed image:

```json
{
  "total_images": 2,
  "successful": 2,
  "failed": 0,
  "results": [
    {
      "filename": "sample.tif",
      "num_bands_extracted": 7,
      "band_urls": [
        "http://server/media/extracted_bands/sample/001.png"
      ],
      "output_folder_name": "sample",
      "output_dir": "media/extracted_bands/sample"
    }
  ]
}
```

Use `output_folder_name` as the key for band selections and as the value in
`name_of_images`. Do not use the original filename when the two values differ.

### List extracted bands

```http
GET /api/rtlc/extracted_bands/
```

This is useful when the frontend needs to reload previously extracted bands:

```json
{
  "total_images": 1,
  "results": [
    {
      "image_folder": "sample",
      "num_bands_extracted": 7,
      "bands": [
        {
          "index": 1,
          "filename": "001.png",
          "url": "http://server/media/extracted_bands/sample/001.png"
        }
      ]
    }
  ]
}
```

### Create clusters

```http
POST /api/rtlc/make_clusters/
Content-Type: application/json
```

### List models

```http
GET /api/rtlc/list_models/
```

### View a datapoint

```http
GET /api/rtlc/datapoint/?image_folder=sample&band_index=3
```

The response contains the selected band image URL:

```json
{
  "image_folder": "sample",
  "band_index": 3,
  "filename": "003.png",
  "band_url": "http://server/media/extracted_bands/sample/003.png"
}
```

## Band Selection

There is no separate save-selection API. Keep the selection state in the
frontend and submit it with `make_clusters`.

For example, if the user selects bands 1–3 from two images:

```json
{
  "name_of_images": ["image_one", "image_two"],
  "selected_bands": {
    "image_one": [1, 2, 3],
    "image_two": [1, 2, 3]
  }
}
```

The complete clustering payload can include:

```json
{
  "model_weights_path": "./models/autoencoder_300.pkl",
  "name_of_images": ["image_one", "image_two"],
  "clustering_dimentions": 3,
  "clustering_file_name": "my_cluster",
  "label_method": "kmeans",
  "selected_bands": {
    "image_one": [1, 2, 3],
    "image_two": [1, 2, 3]
  }
}
```

If all bands should be clustered, either omit `selected_bands` or send an empty
object and provide all extracted folder names in `name_of_images`.

The backend validates that:

- Image folders exist.
- Selected band indices are positive integers.
- Selected band files exist.
- Selected folders are included in `name_of_images`.

Only the selected bands from all selected images are clustered.

### Clustering response

```json
{
  "status": "success",
  "message": "Clustering dashboard generated successfully...",
  "cluster_file_name": "my_cluster",
  "cluster_url": "/media/clusters/my_cluster.html",
  "selected_band_counts": {
    "image_one": 3,
    "image_two": 3
  }
}
```

Use `selected_band_counts` to show the frontend summary. The total number of
expected datapoints is the sum of its values. The cluster URL may be relative,
so prepend the Django server base URL when the frontend and backend use
different origins.

## Recommended Frontend State

Keep selections keyed by extracted folder name so changing the active image
does not reset the previous image's selection:

```ts
type BandSelections = Record<string, number[]>;

const [bandSelections, setBandSelections] = useState<BandSelections>({});
const [selectionMode, setSelectionMode] = useState<"all" | "manual">("all");
const [activeImageFolder, setActiveImageFolder] = useState("");
```

When the user changes the active image, read and update only
`bandSelections[activeImageFolder]`. For manual mode, include only images with
at least one selected band in `name_of_images` and `selected_bands`. For
select-all mode, include every extracted folder and omit `selected_bands` (or
send `{}`).

## Datapoint Viewing

The generated Plotly cluster dashboard stores the source image and band image
URL for every datapoint. Clicking a datapoint opens its band image in a dialog.
Clicking the image opens it at full size in a new browser tab.

If the frontend renders its own cluster points, call the `datapoint` endpoint
with the point's `image_folder` and `band_index`, then show the returned
`band_url` in a dialog. The band image URL can also be opened directly.

## Error Handling

For failed requests, display the backend's `error` or `message` field to the
user. Important status codes are:

- `400`: invalid upload, selection, folder, or band index.
- `404`: requested datapoint or band does not exist.
- `500`: clustering or server-side processing failure.

## Backend Files

- [`app/rtlc/views.py`](app/rtlc/views.py): API endpoints and request validation.
- [`app/rtlc/urls.py`](app/rtlc/urls.py): RTLC API routes.
- [`app/rtlc/services.py`](app/rtlc/services.py): image analysis and band extraction.
- [`app/rtlc/utils/data_preprocessing.py`](app/rtlc/utils/data_preprocessing.py):
  selected-band filtering.
- [`app/rtlc/utils/clustering.py`](app/rtlc/utils/clustering.py): clustering,
  source-image coloring, and datapoint previews.
- [`app/rtlc/app.py`](app/rtlc/app.py): prototype/check application only.
