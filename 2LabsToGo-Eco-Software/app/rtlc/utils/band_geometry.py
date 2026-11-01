def calculate_band_spacing(result):
    spacings = calculate_band_spacings(result)
    if not spacings:
        return None

    return sum(spacings) / len(spacings)


def calculate_band_spacings(result):
    centers_x = sorted(
        float(value)
        for value in result.get("rectangle_centers_x", [])
    )
    if len(centers_x) < 2:
        return []

    band_width = float(result.get("rectangle_width", 1.0))
    return [
        max(
            0.0,
            centers_x[index + 1] - centers_x[index] - band_width,
        )
        for index in range(len(centers_x) - 1)
    ]


def apply_manual_override(
    result,
    num_bands,
    first_app_position,
    edge_cut,
    migration_front,
    band_spacing,
    band_width,
):
    updated = dict(result)
    mask = result["mask"]
    image_bottom_y = float(max(0, int(mask.shape[0]) - 1))

    num_bands = max(0, int(float(num_bands)))
    first_app_position = float(first_app_position)
    edge_cut = max(0.0, float(edge_cut))
    migration_front = max(0.0, float(migration_front))
    band_spacing = max(0.0, float(band_spacing))
    band_width = max(1.0, float(band_width))

    center_step = band_width + band_spacing
    updated["rectangle_centers_x"] = [
        first_app_position + index * center_step
        for index in range(num_bands)
    ]

    top_y = image_bottom_y - migration_front
    bottom_y = image_bottom_y - edge_cut
    top_y = min(image_bottom_y, max(0.0, top_y))
    bottom_y = min(image_bottom_y, max(0.0, bottom_y))

    if bottom_y < top_y:
        top_y, bottom_y = bottom_y, top_y

    updated["global_top_y"] = top_y
    updated["global_bottom_y"] = bottom_y
    updated["rectangle_width"] = band_width
    return updated
