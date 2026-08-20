import os
from pathlib import Path
import requests

import matplotlib
matplotlib.use("Agg")  # no GUI backend needed
import matplotlib.pyplot as plt
from matplotlib.patches import Rectangle
import numpy as np
from PIL import Image as PILImage

from shiny import App, reactive, render, ui

# Define the user interface matching your layout with the new clustering panel added[cite: 5, 6]
app_ui = ui.page_fluid(
    ui.h2("Track detection viewer (Django Backend Connected)"),
    ui.layout_sidebar(
        ui.sidebar(
            ui.input_file(
                "image_file",
                "Upload an image",
                accept=[".png", ".jpg", ".jpeg", ".tif", ".tiff"],
                multiple=True,
            ),
            ui.input_select("selected_image", "Preview image", choices={}),
            ui.hr(),
            ui.input_checkbox("manual_mode", "Manual override markings", value=False),
            ui.input_numeric("num_bands", "num_bands", value=0, min=0, step=1),
            ui.input_numeric("first_app_position", "first_app_position", value=0.0, step=1.0),
            ui.input_numeric("edge_cut", "edge_cut", value=0.0, step=1.0),
            ui.input_numeric("migration_front", "migration_front", value=0.0, step=1.0),
            ui.input_numeric("band_spacing", "band_spacing (px)", value=30.0, min=1.0, step=1.0),
            ui.input_numeric("band_width", "band_width (px)", value=10.0, min=1.0, step=1.0),
            ui.p("Tip: Upload first, then tweak values in manual mode."),
            ui.hr(),
            ui.input_action_button("extract_btn", "Extract Bands", class_="btn-primary"),
            ui.output_text_verbatim("extract_status"),
            ui.hr(),
            # --- New Clustering Controls ---
            ui.h4("Cluster Analysis"),
            ui.input_text("model_weights_path", "Model Weights Path", value="./models/autoencoder_300.pkl"),
            ui.input_numeric("clustering_dimensions", "Clustering Dimensions", value=3, min=1, step=1),
            ui.input_text("clustering_file_name", "Cluster File Name", value="cluster_output"),
            ui.input_checkbox(
                "cluster_all",
                "Cluster ALL extracted images (ignore current upload)",
                value=False,
            ),
            ui.input_action_button("cluster_btn", "Make Clusters", class_="btn-success"),
            ui.output_text_verbatim("cluster_status"),
        ),
        ui.output_plot("marked_plot"),
        ui.output_text_verbatim("summary"),
        ui.hr(),
        ui.h4("Cluster Dashboard"),
        ui.output_ui("cluster_dashboard"),
    ),
)


def server(input, output, session):
    django_analysis_results = reactive.Value({})
    loading_state = reactive.Value(False)
    extract_status_value = reactive.Value({})
    cluster_status_value = reactive.Value({})

    DJANGO_API_URL = "http://127.0.0.1:8000/api/rtlc"

    @reactive.calc
    def uploaded_files():
        uploaded = input.image_file()
        if not uploaded:
            return []
        return uploaded

    @reactive.calc
    def selected_uploaded_file():
        files = uploaded_files()
        if not files:
            return None
        selected_name = input.selected_image()
        for file_info in files:
            if file_info.get("name") == selected_name:
                return file_info
        return files[0]

    @reactive.calc
    def uploaded_path():
        selected_file = selected_uploaded_file()
        if selected_file is None:
            return None
        return selected_file["datapath"]

    @reactive.calc
    def selected_image_name():
        selected_file = selected_uploaded_file()
        if selected_file is None:
            return None
        return selected_file.get("name")

    @reactive.effect
    @reactive.event(uploaded_files, input.manual_mode, input.num_bands, input.first_app_position, input.edge_cut, input.migration_front, input.band_spacing, input.band_width)
    def fetch_django_analysis():
        files = uploaded_files()
        if not files:
            django_analysis_results.set({})
            return

        loading_state.set(True)
        try:
            files_to_send = []
            for f in files:
                files_to_send.append(
                    ("image", (f["name"], open(f["datapath"], "rb"), f["type"]))
                )

            data = {}
            if input.manual_mode():
                data = {
                    "manual_mode": "true",
                    "num_bands": str(input.num_bands()),
                    "first_app_position": str(input.first_app_position()),
                    "edge_cut": str(input.edge_cut()),
                    "migration_front": str(input.migration_front()),
                    "band_spacing": str(input.band_spacing()),
                    "band_width": str(input.band_width()),
                }

            response = requests.post(f"{DJANGO_API_URL}/analyze_image/", files=files_to_send, data=data)
            
            for _, file_tuple in files_to_send:
                file_tuple[1].close()

            if response.status_code == 200:
                res_json = response.json()
                results_map = {}
                for item in res_json.get("results", []):
                    filename = item.get("filename") or list(files)[0]["name"]
                    results_map[filename] = item
                django_analysis_results.set(results_map)
            else:
                django_analysis_results.set({"error": response.text})

        except Exception as e:
            django_analysis_results.set({"error": str(e)})
        finally:
            loading_state.set(False)

    @reactive.effect
    @reactive.event(uploaded_files)
    def _sync_image_choices():
        files = uploaded_files()
        choices = {file_info.get("name", f"image_{idx + 1}"): file_info.get("name", f"image_{idx + 1}") for idx, file_info in enumerate(files)}

        if not choices:
            ui.update_select("selected_image", choices={}, selected=None)
            return

        selected_name = input.selected_image()
        if selected_name not in choices:
            selected_name = next(iter(choices.keys()))

        ui.update_select("selected_image", choices=choices, selected=selected_name)

    @reactive.calc
    def selected_analysis_result():
        image_name = selected_image_name()
        if image_name is None:
            return None
        results = django_analysis_results()
        return results.get(image_name)

    @render.plot
    def marked_plot():
        path = uploaded_path()
        result = selected_analysis_result()

        if path is None or result is None or "error" in result:
            fig, ax = plt.subplots(figsize=(8, 4))
            ax.text(0.5, 0.5, "Waiting for Django backend analysis...", ha="center", va="center")
            ax.axis("off")
            return fig

        image = PILImage.open(path).convert("RGB")
        canvas = np.asarray(image)
        canvas_h, canvas_w = canvas.shape[:2]

        rectangle_centers_x = result.get("rectangle_centers_x", [])
        global_top_y = float(result.get("global_top_y", 0.0))
        global_bottom_y = float(result.get("global_bottom_y", 0.0))
        rectangle_width = float(result.get("rectangle_width", 1.0))

        # --- THE FIX: Direct Independent Scaling ---
        mask_w = 1024.0
        mask_h = 1024.0

        scale_x = float(canvas_w) / mask_w
        scale_y = float(canvas_h) / mask_h

        fig, ax = plt.subplots(figsize=(8, 8))
        ax.imshow(canvas)

        ax.set_xlim(0, canvas_w)
        ax.set_ylim(canvas_h, 0)

        half_len = 15.0 * scale_y
        y0 = global_top_y * scale_y
        y1 = global_bottom_y * scale_y

        if abs(y1 - y0) < 1.0:
            y0 = max(0.0, y0 - half_len)
            y1 = min(float(canvas_h - 1), y1 + half_len)

        for x in rectangle_centers_x:
            x_center = float(x) * scale_x
            rect_width = max(1.0, rectangle_width * scale_x)
            
            rect = Rectangle(
                (x_center - rect_width / 2.0, y0),
                rect_width,
                max(1.0, y1 - y0),
                linewidth=1.5,
                edgecolor="cyan",
                facecolor="none",
                alpha=0.9,
            )
            ax.add_patch(rect)

        ax.set_title("Image + Django Markings")
        ax.axis("off")
        plt.tight_layout()
        return fig

    @render.text
    def summary():
        result = selected_analysis_result()
        if result is None:
            return "No image uploaded yet."
        if "error" in result:
            return f"Backend Error: {result['error']}"

        mode = "manual" if input.manual_mode() else "auto"
        selected_name = selected_image_name() or ""
        return f"selected image: {selected_name}\nmode: {mode}\nStatus: Connected to Django Backend"

    @reactive.effect
    @reactive.event(input.extract_btn)
    def _handle_extract():
        files = uploaded_files()
        if not files:
            return

        extracted = []
        errors = []

        try:
            files_to_send = [
                ("image", (f["name"], open(f["datapath"], "rb"), f["type"])) for f in files
            ]
            response = requests.post(f"{DJANGO_API_URL}/extract_bands/", files=files_to_send)

            for _, file_tuple in files_to_send:
                file_tuple[1].close()

            if response.status_code == 200:
                res_json = response.json()
                for item in res_json.get("results", []):
                    extracted.append("Successfully processed and extracted bands via Django.")
            else:
                errors.append(response.text)
        except Exception as exc:
            errors.append(str(exc))

        extract_status_value.set(
            {
                "success": len(errors) == 0,
                "extracted": extracted,
                "errors": errors,
            }
        )

    @render.text
    def extract_status():
        status = extract_status_value()
        if not status:
            return ""

        lines = []
        if status.get("extracted"):
            lines.append("Extracted via Django:")
            lines.extend(status["extracted"])
        if status.get("errors"):
            lines.append("Errors:")
            lines.extend(status["errors"])
        return "\n".join(lines)

    # --- New Clustering Effect & Renderer (Updated with .stem) ---
    @reactive.effect
    @reactive.event(input.cluster_btn)
    def _handle_clustering():
        if input.cluster_all():
            # Empty list tells the backend to scan every subfolder under
            # ./media/extracted_bands/ instead of just the current upload.
            image_names = []
        else:
            files = uploaded_files()
            if not files:
                cluster_status_value.set({"success": False, "message": "Please upload images first."})
                return
            # Strip extensions (e.g., .tif) so names match the extracted folder structure precisely
            image_names = [Path(f["name"]).stem for f in files]

        try:
            payload = {
                "model_weights_path": input.model_weights_path(),
                "name_of_images": image_names,
                "clustering_dimentions": input.clustering_dimensions(),
                "clustering_file_name": input.clustering_file_name(),
            }

            response = requests.post(f"{DJANGO_API_URL}/make_clusters/", json=payload)

            if response.status_code == 200:
                res_json = response.json()
                cluster_status_value.set({
                    "success": True,
                    "message": res_json.get("message", "Clustering completed successfully!"),
                    "cluster_url": res_json.get("cluster_url"),
                })
            else:
                cluster_status_value.set({
                    "success": False,
                    "message": f"Error: {response.text}"
                })
        except Exception as exc:
            cluster_status_value.set({
                "success": False,
                "message": f"Exception: {str(exc)}"
            })

    @render.text
    def cluster_status():
        status = cluster_status_value()
        if not status:
            return ""
        return status.get("message", "")

    @render.ui
    def cluster_dashboard():
        status = cluster_status_value()
        url = status.get("cluster_url") if status else None
        if not url:
            return ui.p("No cluster dashboard yet. Run 'Make Clusters' to generate one.")

        full_url = f"{DJANGO_API_URL.replace('/api/rtlc', '')}{url}"
        return ui.tags.iframe(
            src=full_url,
            style="width:100%; height:600px; border:1px solid #ccc;",
        )


def create_app():
    return App(app_ui, server)


app = create_app()


def run_shiny_app(host: str = "0.0.0.0", port: int = 8000):
    from shiny import run_app
    run_app(app, host=host, port=port, launch_browser=False)


def main():
    host = os.getenv("SHINY_HOST", "0.0.0.0")
    port = int(os.getenv("SHINY_PORT", "8058"))
    run_shiny_app(host=host, port=port)


if __name__ == "__main__":
    main()