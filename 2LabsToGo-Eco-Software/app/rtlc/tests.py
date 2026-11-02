import json
import os
import tempfile
import time
from pathlib import Path

import numpy as np
from django.test import TestCase, override_settings

from .utils.clustering import get_clusters, nearest_points
from .utils.image_marking import MARKED_IMAGE_MAX_AGE_SECONDS, delete_old_marked_images


class DeleteOldMarkedImagesTests(TestCase):
    def test_deletes_only_marked_images_past_the_age_limit(self):
        with tempfile.TemporaryDirectory() as directory:
            directory = Path(directory)
            old_marked = directory / "a_marked_11111111.png"
            new_marked = directory / "b_marked_22222222.png"
            old_other = directory / "notes.png"
            for path in (old_marked, new_marked, old_other):
                path.touch()
            expired = time.time() - MARKED_IMAGE_MAX_AGE_SECONDS - 60
            os.utime(old_marked, (expired, expired))
            os.utime(old_other, (expired, expired))

            delete_old_marked_images(directory)

            self.assertFalse(old_marked.exists())
            self.assertTrue(new_marked.exists())
            self.assertTrue(old_other.exists())


class NearestPointsTests(TestCase):
    def test_orders_by_plot_distance_and_excludes_selected_point(self):
        coordinates = [[0, 0], [5, 0], [1, 0], [3, 0]]

        self.assertEqual(
            nearest_points(coordinates, 0, 2),
            [(2, 1.0), (3, 3.0)],
        )

    def test_returns_every_other_point_when_fewer_than_requested(self):
        self.assertEqual(len(nearest_points([[0, 0], [1, 1]], 0, 5)), 1)


class CompareDatapointsTests(TestCase):
    url = "/api/rtlc/compare_datapoints/"

    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.media_root = directory.name
        settings_override = override_settings(MEDIA_ROOT=directory.name)
        settings_override.enable()
        self.addCleanup(settings_override.disable)

        get_clusters(
            np.array([[0.0, 0.0, 0.0], [10.0, 0.0, 0.0], [1.0, 0.0, 0.0], [0.0, 2.0, 0.0]]),
            np.array([0, 1, 1, 2]),
            ["a/1.png", "a/2.png", "b/1.png", "c/1.png"],
            dims=3,
            cluster_name="plot",
            output_dir=str(Path(directory.name) / "clusters"),
        )

    def _get(self, **params):
        return self.client.get(self.url, {"cluster_file_name": "plot", **params})

    def test_manual_returns_selected_points_in_order(self):
        response = self._get(mode="manual", points=[3, 0])

        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            [point["image_name"] for point in response.data["datapoints"]],
            ["c/1.png", "a/1.png"],
        )
        self.assertEqual(
            response.data["datapoints"][0]["image_url"],
            "/media/extracted_bands/c/1.png",
        )

    def test_manual_requires_two_points(self):
        self.assertEqual(self._get(mode="manual", points=[0, 0]).status_code, 400)

    def test_nearest_crosses_clusters_and_lists_selected_point_first(self):
        response = self._get(mode="nearest", points=[0], n_neighbors=2)

        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            [
                (point["index"], point["distance"], point["cluster"])
                for point in response.data["datapoints"]
            ],
            [(0, 0.0, "0"), (2, 1.0, "1"), (3, 2.0, "2")],
        )

    def test_nearest_rejects_invalid_requests(self):
        self.assertEqual(self._get(mode="nearest", points=[0, 1], n_neighbors=2).status_code, 400)
        self.assertEqual(self._get(mode="nearest", points=[0], n_neighbors=0).status_code, 400)
        self.assertEqual(self._get(mode="nearest", points=[0]).status_code, 400)
        self.assertEqual(self._get(mode="nearest", points=[99], n_neighbors=1).status_code, 400)

    def test_unknown_cluster_and_path_traversal_are_not_found(self):
        media_root = Path(self.media_root)
        (media_root / "secret.json").write_text(json.dumps({"points": []}))

        for name in ("missing", "../secret"):
            response = self.client.get(
                self.url,
                {"cluster_file_name": name, "mode": "manual", "points": [0, 1]},
            )
            self.assertEqual(response.status_code, 404)
