# rTLC Backend REST APIs

**Source files:**

- [`app/rtlc/urls.py`](app/rtlc/urls.py)
- [`app/rtlc/views.py`](app/rtlc/views.py)
- [`app/rtlc/services.py`](app/rtlc/services.py)

## API overview

| Method | URL | Purpose |
|---|---|---|
| `POST` | `/api/rtlc/analyze_image/` | Analyzes uploaded TLC images and detects band positions. |
| `POST` | `/api/rtlc/extract_bands/` | Crops detected TLC bands and saves them for later use. |
| `GET` | `/api/rtlc/extracted_bands/` | Lists previously extracted bands and their media URLs. |
| `GET` | `/api/rtlc/datapoint/` | Retrieves one extracted band by folder and band index. |
| `POST` | `/api/rtlc/make_clusters/` | Generates an interactive clustering dashboard from extracted bands. |
| `GET` | `/api/rtlc/list_models/` | Lists available clustering model-weight files. |

## Typical rTLC workflow

```text
Upload image
    ↓
/api/rtlc/analyze_image/
    ↓
Review and manually edit detected markings
    ↓
/api/rtlc/extract_bands/
    ↓
/api/rtlc/extracted_bands/
    ↓
/api/rtlc/datapoint/
    ↓
/api/rtlc/make_clusters/
```

The frontend can call `/api/rtlc/list_models/` before clustering to show the available model files.

---

## 1. Image analysis

### `POST /api/rtlc/analyze_image/`

#### Purpose

Analyzes one or more uploaded TLC images. It uses the FastSAM segmentation model to identify band regions, calculates their positions and spacing, creates a marked copy of each image, and returns the analysis results.

#### Request

- **Content type:** `multipart/form-data`
- **File field:** `image`
- **Optional field:** `marking_values`

Multiple files may be uploaded using the same `image` field.

```bash
curl -X POST http://localhost:8000/api/rtlc/analyze_image/ \
  -F "image=@sample.png"
```

Example manual corrections:

```json
{
  "sample.png": {
    "num_bands": 5,
    "first_app_position": 82,
    "edge_cut": 10,
    "migration_front": 720,
    "band_spacing": 125,
    "band_width": 42
  }
}
```

#### Processing

1. Retrieves uploaded files from the `image` field.
2. Validates extensions, filenames, size, and image integrity.
3. Runs FastSAM to generate a segmentation mask.
4. Analyzes the mask to identify band-like regions and vertical tracks.
5. Calculates band centers, widths, boundaries, and spacing.
6. Applies optional manual corrections.
7. Draws cyan rectangles over the detected bands.
8. Saves the marked image under `media/marked_images/`.
9. Returns a JSON response.

#### Main functions

| Function | Purpose |
|---|---|
| `analyze_image()` | Processes all uploaded images and builds the batch response. |
| `_get_uploaded_files()` | Retrieves the `image` files and starts validation. |
| `validate_uploaded_images()` | Validates filenames, extensions, file size, and image integrity. |
| `get_marking_values()` | Parses and validates optional manual corrections. |
| `analyze_single_image()` | Performs complete analysis for one image. |
| `_analyze_path()` | Runs segmentation and band analysis for a temporary image file. |
| `Mask_builder.get_mask()` | Converts FastSAM output into a binary mask. |
| `TrackMarker.analyze_mask()` | Detects blobs, tracks, band centers, spacing, and boundaries. |
| `_apply_marking_values()` | Applies manual corrections to automatic results. |
| `create_marked_image()` | Draws cyan band rectangles and saves the marked image. |
| `_build_results_response()` | Builds the final batch response. |

#### Response example

```json
{
  "total_images": 1,
  "successful": 1,
  "failed": 0,
  "results": [
    {
      "filename": "sample.png",
      "marked_image_url": "http://localhost:8000/media/marked_images/sample_marked_a1b2c3d4.png",
      "rectangle_centers_x": [120.5, 245.2, 370.8],
      "global_top_y": 80.0,
      "global_bottom_y": 720.0,
      "rectangle_width": 42.0,
      "summary": {
        "band_spacing": 125.1,
        "band_spacings": [124.7, 125.6]
      }
    }
  ]
}
```

#### Manual editing workflow

The automatically detected markings are not final. After analysis:

1. The frontend displays the marked image.
2. The user can adjust the number of bands, first application position, edge cut, migration front, band spacing, and band width.
3. The corrected `marking_values` are sent to `/api/rtlc/extract_bands/`.
4. The extraction endpoint uses the corrected geometry to crop the final bands.

---

## 2. Band extraction

### `POST /api/rtlc/extract_bands/`

#### Purpose

Extracts individual TLC bands from uploaded images. It performs image analysis, applies manual corrections, crops the final band regions, and saves the crops under `media/extracted_bands/`.

#### Request

- **Content type:** `multipart/form-data`
- **File field:** `image`
- **Optional field:** `marking_values`

```bash
curl -X POST http://localhost:8000/api/rtlc/extract_bands/ \
  -F "image=@sample.png"
```

With manual corrections:

```bash
curl -X POST http://localhost:8000/api/rtlc/extract_bands/ \
  -F "image=@sample.png" \
  -F 'marking_values={"sample.png":{"num_bands":5,"band_spacing":125,"band_width":42}}'
```

#### Processing

1. Validates uploaded files.
2. Runs FastSAM segmentation.
3. Calculates band geometry.
4. Applies manual corrections when provided.
5. Crops each band using the final geometry.
6. Saves cropped files in a unique folder under `media/extracted_bands/`.
7. Returns extraction metadata and media URLs.

#### Main functions

| Function | Purpose |
|---|---|
| `extract_bands()` | Handles batch band extraction. |
| `_get_uploaded_files()` | Retrieves and validates uploaded images. |
| `get_marking_values()` | Reads optional manual corrections. |
| `extract_single_image()` | Processes and extracts bands from one image. |
| `_analyze_path()` | Generates the segmentation mask and automatic geometry. |
| `_apply_marking_values()` | Applies manual geometry corrections. |
| `extract_and_save_bands()` | Crops and saves each detected band as a PNG file. |
| `_build_results_response()` | Builds the final response. |

#### Response example

```json
{
  "total_images": 1,
  "successful": 1,
  "failed": 0,
  "results": [
    {
      "filename": "sample.png",
      "num_bands_extracted": 5,
      "band_urls": [
        "http://localhost:8000/media/extracted_bands/sample/001.png",
        "http://localhost:8000/media/extracted_bands/sample/002.png"
      ],
      "summary": {
        "band_spacing": 125.0,
        "band_spacings": [124.8, 125.6]
      },
      "output_dir": "/app/media/extracted_bands/sample",
      "output_folder_name": "sample"
    }
  ]
}
```

---

## 3. Extracted-band listing

### `GET /api/rtlc/extracted_bands/`

#### Purpose

Scans the extracted-band storage directory and returns all available extracted bands grouped by source-image folder. It does not perform new analysis or extraction.

#### Request

No parameters are required.

```bash
curl http://localhost:8000/api/rtlc/extracted_bands/
```

#### Processing

1. Locates `MEDIA_ROOT/extracted_bands/`.
2. Treats each subfolder as an image folder.
3. Finds supported image files.
4. Converts numeric filenames into band indexes.
5. Builds absolute media URLs.
6. Returns folders and bands as JSON.

Supported extensions are:

```text
.png
.jpg
.jpeg
.tif
.tiff
```

Files with non-numeric stems are ignored. For example, `001.png` is treated as band index `1`.

#### Main functions

| Function | Purpose |
|---|---|
| `extracted_bands()` | Lists extracted-band folders and files. |
| `_extracted_bands_root()` | Returns the extracted-band storage path. |
| `_band_files()` | Finds supported files and maps filenames to indexes. |

#### Response example

```json
{
  "results": [
    {
      "image_folder": "sample",
      "num_bands_extracted": 3,
      "bands": [
        {
          "index": 1,
          "filename": "001.png",
          "url": "http://localhost:8000/media/extracted_bands/sample/001.png"
        },
        {
          "index": 2,
          "filename": "002.png",
          "url": "http://localhost:8000/media/extracted_bands/sample/002.png"
        }
      ]
    }
  ],
  "total_images": 1
}
```

If no extracted folders exist:

```json
{
  "results": [],
  "total_images": 0
}
```

---

## 4. Datapoint retrieval

### `GET /api/rtlc/datapoint/`

#### Purpose

Retrieves metadata and a media URL for one already-extracted band. It does not analyze, crop, or modify images.

#### Request

Required query parameters:

- `image_folder`
- `band_index`

```bash
curl "http://localhost:8000/api/rtlc/datapoint/?image_folder=sample&band_index=1"
```

#### Processing

1. Checks that both query parameters are present.
2. Converts `band_index` to an integer.
3. Locates the requested folder.
4. Finds the requested numeric band file.
5. Builds an absolute media URL.
6. Returns the band metadata.

#### Main functions

| Function | Purpose |
|---|---|
| `datapoint()` | Validates parameters and returns one band’s metadata. |
| `_band_files()` | Locates and indexes files in the requested folder. |
| `request.build_absolute_uri()` | Converts the media path into a complete URL. |

#### Successful response

```json
{
  "image_folder": "sample",
  "band_index": 1,
  "filename": "001.png",
  "band_url": "http://localhost:8000/media/extracted_bands/sample/001.png"
}
```

#### Error responses

Missing parameters:

```json
{
  "error": "image_folder and band_index are required."
}
```

Invalid index:

```json
{
  "error": "band_index must be an integer."
}
```

Missing band:

```json
{
  "error": "The requested band does not exist."
}
```

The endpoint returns `400 Bad Request` for missing or invalid parameters and `404 Not Found` when the requested band does not exist.

---

## 5. Clustering dashboard

### `POST /api/rtlc/make_clusters/`

#### Purpose

Creates an interactive clustering dashboard from extracted TLC bands. It loads selected band images, generates latent feature representations using an autoencoder, applies the selected labeling or clustering method, reduces the features with PCA, and writes an interactive Plotly HTML dashboard.

#### Request

The endpoint accepts `application/json` and `multipart/form-data`.

```json
{
  "model_weights_path": "./models/autoencoder_300.pkl",
  "name_of_images": ["sample_1", "sample_2"],
  "clustering_dimentions": 3,
  "clustering_file_name": "sample_clusters",
  "label_method": "kmeans",
  "selected_bands": {
    "sample_1": [1, 2],
    "sample_2": [1, 3]
  }
}
```

#### Request fields

| Field | Description |
|---|---|
| `model_weights_path` | Autoencoder weights path; defaults to `./models/autoencoder_300.pkl`. |
| `name_of_images` | List of extracted-band folder names to include. |
| `clustering_dimentions` | PCA output dimension, normally `2` or `3`; defaults to `3`. |
| `clustering_file_name` | Name of the generated HTML dashboard. |
| `label_method` | Labeling method; the API defaults to `kmeans`. |
| `selected_bands` | Optional mapping of folder names to selected positive integer band indexes. |

#### Processing

1. Normalizes request values.
2. Validates `selected_bands`.
3. Checks folder names against `name_of_images`.
4. Checks that requested band indexes exist.
5. Loads selected band images.
6. Generates latent representations with the autoencoder.
7. Generates labels using the requested method.
8. Reduces features with PCA.
9. Creates an interactive Plotly visualization.
10. Saves the dashboard under `media/clusters/`.

The generated dashboard includes clickable points that can open the related extracted band image.

#### Main functions

| Function | Purpose |
|---|---|
| `make_clusters()` | Main handler and validation layer. |
| `_as_list()` | Normalizes list, JSON-array, or comma-separated input. |
| `_as_int()` | Converts numeric request values to integers. |
| `_as_string()` | Converts request values to strings with defaults. |
| `_normalise_selected_bands()` | Validates folders and band indexes. |
| `_band_files()` | Confirms that requested bands exist. |
| `perform_clustering()` | Runs loading, inference, labeling, PCA, and dashboard generation. |
| `get_inference_tensor()` | Loads selected bands into model input tensors. |
| `load_model()` | Loads the selected autoencoder weights. |
| `get_latent_representation()` | Produces latent vectors using the model encoder. |
| `get_labels()` | Generates labels, including K-means labels when requested. |
| `pca()` | Reduces latent vectors to the requested dimensions. |
| `get_clusters()` | Creates and saves the interactive Plotly dashboard. |

#### Successful response

```json
{
  "status": "success",
  "message": "Clustering dashboard generated successfully as sample_clusters.html using 4 selected bands from 2 images. Per-image counts: sample_1=2, sample_2=2.",
  "cluster_file_name": "sample_clusters",
  "cluster_url": "/media/clusters/sample_clusters.html",
  "selected_band_counts": {
    "sample_1": 2,
    "sample_2": 2
  }
}
```

#### Error responses

Validation error:

```json
{
  "error": "Band indices are not available for sample_1: [5]."
}
```

Status: `400 Bad Request`

Processing error:

```json
{
  "status": "error",
  "message": "Unable to perform clustering."
}
```

Status: `500 Internal Server Error`

Detailed exceptions are logged by the backend.

---

## 6. Model listing

### `GET /api/rtlc/list_models/`

#### Purpose

Lists available model-weight files from the backend `models/` directory. It does not load, execute, or verify model compatibility.

#### Request

No parameters are required.

```bash
curl http://localhost:8000/api/rtlc/list_models/
```

#### Processing

1. Locates the backend `models/` directory.
2. Includes files with these extensions:
   - `.pkl`
   - `.pth`
   - `.pt`
3. Sorts the files alphabetically.
4. Returns each model name and relative path.

The current implementation does **not** return file sizes and does **not** include `.onnx`, `.h5`, `.keras`, or `.zip` files.

#### Main function

| Function | Purpose |
|---|---|
| `list_models()` | Scans the model directory and returns available model metadata. |

#### Response example

```json
{
  "models": [
    {
      "name": "autoencoder_100",
      "path": "./models/autoencoder_100.pkl"
    },
    {
      "name": "autoencoder_200",
      "path": "./models/autoencoder_200.pkl"
    },
    {
      "name": "autoencoder_300",
      "path": "./models/autoencoder_300.pkl"
    }
  ]
}
```

The `name` field is the filename without its extension. If no supported model files are present:

```json
{
  "models": []
}
```

The selected path can subsequently be supplied to `/api/rtlc/make_clusters/` using `model_weights_path`.

---

## Common validation and error behavior

### Uploaded images

The image-upload endpoints validate:

- Filename uniqueness within the request.
- Supported extensions.
- Image readability.
- Maximum configured upload size.
- Valid image content using Pillow.

Supported extensions are:

```text
.png
.jpg
.jpeg
.tif
.tiff
```

### Partial batch failures

The analysis and extraction endpoints process each uploaded image separately. If one image fails, the response can contain successful results for other images and an `errors` array for failed files.

```json
{
  "total_images": 2,
  "successful": 1,
  "failed": 1,
  "results": [],
  "errors": [
    {
      "filename": "failed-image.png",
      "error": "Unable to analyze image."
    }
  ]
}
```

### Path handling

Extracted-band lookup verifies that the requested folder resolves inside the configured `media/extracted_bands/` directory. This prevents the lookup logic from treating arbitrary paths outside the extracted-band directory as valid band folders.

## Important distinctions

- `/analyze_image/` detects and displays band geometry.
- Manual editing changes the geometry values used for extraction.
- `/extract_bands/` creates cropped band images.
- `/extracted_bands/` lists saved cropped images.
- `/datapoint/` retrieves one saved cropped image.
- `/make_clusters/` analyzes selected cropped images and generates the clustering dashboard.
- `/list_models/` lists model files available for clustering.
