# rTLC: Compare Datapoints



## What it does

| Mode | User action | Result |
|---|---|---|
| Manual selection | Click 2 or more points, then press Compare | The selected bands, side by side, in click order |
| Nearest selection | Click 1 point, set the number of neighbours, then press Compare | The selected band first, then its closest points, nearest first |

"Closest" means Euclidean distance on the plot's own 2D or 3D PCA coordinates, not in the
original latent space. Neighbours are searched across all points, whatever their cluster.

## Files changed

| File | Change |
|---|---|
| `urls.py` | Added the `compare_datapoints` route |
| `views.py` | Added the `compare_datapoints` view and the `_load_cluster_points` helper |
| `utils/clustering.py` | Added `nearest_points`, the `.json` points file, and the plot page's selection script |
| `app.py` | Added compare controls and the result window to the Shiny app |
| `tests.py` | Added tests for the distance logic and the endpoint |

## API

### `GET /api/rtlc/compare_datapoints/`

| Parameter | Required | Description |
|---|---|---|
| `cluster_file_name` | Always | Name of the clustering run, without an extension |
| `mode` | Always | `manual` or `nearest` |
| `points` | Always | Point index. Repeat the parameter for several points |
| `n_neighbors` | `nearest` only | Number of neighbours, 1 or more |

Duplicate `points` values are ignored.

Example:

```
GET /api/rtlc/compare_datapoints/?cluster_file_name=cluster_output&mode=nearest&points=0&n_neighbors=2
```

Response (shortened to two datapoints):

```json
{
  "mode": "nearest",
  "datapoints": [
    {
      "image_name": "4_1_2_5_2_69_3_1_1_827/001.png",
      "image_url": "/media/extracted_bands/4_1_2_5_2_69_3_1_1_827/001.png",
      "cluster": "2",
      "coordinates": [55.39, 13.29, -12.31],
      "index": 0,
      "distance": 0.0
    },
    {
      "image_name": "4_1_2_5_2_69_3_1_1_827/003.png",
      "image_url": "/media/extracted_bands/4_1_2_5_2_69_3_1_1_827/003.png",
      "cluster": "2",
      "coordinates": [58.47, 12.34, -12.44],
      "index": 2,
      "distance": 3.228
    }
  ]
}
```

In `manual` mode, `distance` is `null`. In `nearest` mode, the selected point is first with a
distance of `0.0`. If fewer points exist than requested, all the other points are returned.
## Clustering output

`get_clusters()` now writes two files to `media/clusters/`:

- `<name>.html`: the interactive plot, as before.
- `<name>.json`: new, and read by the endpoint.

```json
{
  "dimensions": 3,
  "points": [
    {
      "image_name": "folder/001.png",
      "image_url": "/media/extracted_bands/folder/001.png",
      "cluster": "2",
      "coordinates": [55.39, 13.29, -12.31]
    }
  ]
}
```

A point's index is its position in `points`. The same index is stored in each plot point's
`customdata` as `PointIndex`, which is how a click maps to a row in this file.

`nearest_points(coordinates, point_index, n_neighbors)` returns `(index, distance)` pairs,
nearest first, and leaves out the selected point.

## Request flow

1. A click on the plot stores the point's index and name in the browser. It makes no server
   call and does not redraw the plot.
2. Compare sends the request from the plot page straight to Django, without going through the
   Shiny server.
3. Django reads `<name>.json`, picks the points, and returns them.
4. The bands open in one window.

Inside Shiny, the plot page is loaded in an iframe with `?shiny=1`. The two pages communicate
through `postMessage`:

| Message | Direction | Purpose |
|---|---|---|
| `rtlc-ready` | Plot to Shiny | The plot has loaded and needs the current mode |
| `rtlc-mode` | Shiny to plot | Set the mode and clear the selection |
| `rtlc-compare` | Shiny to plot | Run the comparison |
| `rtlc-selection` | Plot to Shiny | Selected names, shown in the status box |
| `rtlc-comparison` | Plot to Shiny | Result to show in the window |
| `rtlc-error` | Plot to Shiny | Error to show in the status box |

Without `?shiny=1`, the plot page shows its own toolbar and comparison window. This keeps the
feature available on any other page that embeds the plot.



## Testing

```bash
cd app
python manage.py test rtlc
```


