"""Focused neutral tests for the build-time vector-map geometry worker.

The fixture intentionally contains no Cards, Money, Trains identifiers or
rules.  It proves the reusable geometric properties independently from the
author's large source map.
"""

from __future__ import annotations

import math
import unittest

from shapely import STRtree
from shapely.geometry import LineString, Polygon

from vector_map_polygonizer import (
    _source_candidate_ids,
    apply_approved_endpoint_snaps,
    find_endpoint_to_line_candidates,
    flatten_cubic,
    geometry_fingerprint,
    polygonize_noded_lines,
)


class VectorMapPolygonizerTests(unittest.TestCase):
    """Exercise flattening, explicit snapping and full diagnostics separately."""

    def test_flatten_cubic_respects_endpoints_and_subdivides_curve(self) -> None:
        points = flatten_cubic(
            (0.0, 0.0),
            (0.0, 10.0),
            (10.0, 10.0),
            (10.0, 0.0),
            0.25,
        )

        self.assertEqual(points[0], (0.0, 0.0))
        self.assertEqual(points[-1], (10.0, 0.0))
        self.assertGreater(len(points), 2)
        self.assertTrue(all(math.isfinite(value) for point in points for value in point))

    def test_snap_changes_only_explicitly_approved_endpoints(self) -> None:
        paths = {
            "boundary-candidate-0001": [(0.0, 0.0), (1.0, 0.0)],
            "boundary-candidate-0002": [(1.2, 0.0), (2.0, 0.0)],
            # This endpoint is even closer, but no approved pair names it.
            "boundary-candidate-0003": [(1.05, 0.0), (1.05, 1.0)],
        }
        pairs = [
            {
                "left": {
                    "candidateId": "boundary-candidate-0001",
                    "endpoint": "end",
                    "point": {"x": 1.0, "y": 0.0},
                },
                "right": {
                    "candidateId": "boundary-candidate-0002",
                    "endpoint": "start",
                    "point": {"x": 1.2, "y": 0.0},
                },
            }
        ]

        clusters = apply_approved_endpoint_snaps(paths, pairs, 3.0)

        self.assertEqual(len(clusters), 1)
        self.assertEqual(paths["boundary-candidate-0001"][-1], (1.1, 0.0))
        self.assertEqual(paths["boundary-candidate-0002"][0], (1.1, 0.0))
        self.assertEqual(paths["boundary-candidate-0003"][0], (1.05, 0.0))
        self.assertEqual(paths["boundary-candidate-0003"][-1], (1.05, 1.0))

    def test_polygonize_returns_face_and_leftover_diagnostics(self) -> None:
        lines = [
            LineString([(0.0, 0.0), (4.0, 0.0)]),
            LineString([(4.0, 0.0), (4.0, 4.0)]),
            LineString([(4.0, 4.0), (0.0, 4.0)]),
            LineString([(0.0, 4.0), (0.0, 0.0)]),
            LineString([(4.0, 4.0), (6.0, 6.0)]),
        ]

        polygons, cuts, dangles, invalids, noded = polygonize_noded_lines(lines)

        self.assertEqual(len(polygons), 1)
        self.assertAlmostEqual(polygons[0].area, 16.0)
        self.assertGreaterEqual(len(noded), 5)
        self.assertGreaterEqual(len(cuts) + len(dangles), 1)
        self.assertEqual(invalids, [])

    def test_endpoint_to_line_reports_only_other_path_interior(self) -> None:
        paths = {
            "boundary-candidate-0001": [(0.0, 1.0), (0.0, 4.0)],
            "boundary-candidate-0002": [(-5.0, 0.0), (5.0, 0.0)],
        }
        lines = [LineString(points) for points in paths.values()]
        *_, noded = polygonize_noded_lines(lines)

        candidates = find_endpoint_to_line_candidates(paths, noded, 3.0)

        self.assertEqual(len(candidates), 1)
        self.assertEqual(
            candidates[0]["endpointSourceCandidateId"],
            "boundary-candidate-0001",
        )
        self.assertEqual(candidates[0]["lineSourceCandidateId"], "boundary-candidate-0002")
        self.assertEqual(candidates[0]["endpoint"], "start")
        self.assertEqual(candidates[0]["distancePx"], 1.0)
        self.assertEqual(candidates[0]["projectedPoint"], {"x": 0.0, "y": 0.0})

    def test_endpoint_to_line_excludes_target_endpoint_and_connected_node(self) -> None:
        endpoint_only_paths = {
            "boundary-candidate-0001": [(0.0, 1.0), (0.0, 4.0)],
            "boundary-candidate-0002": [(0.0, 0.0), (5.0, 0.0)],
        }
        endpoint_only_lines = [
            LineString(points) for points in endpoint_only_paths.values()
        ]
        *_, endpoint_only_noded = polygonize_noded_lines(endpoint_only_lines)
        self.assertEqual(
            find_endpoint_to_line_candidates(
                endpoint_only_paths, endpoint_only_noded, 3.0
            ),
            [],
        )

        connected_paths = {
            "boundary-candidate-0001": [(0.0, 0.0), (0.0, 4.0)],
            "boundary-candidate-0002": [(-5.0, 0.0), (5.0, 0.0)],
        }
        connected_lines = [LineString(points) for points in connected_paths.values()]
        *_, connected_noded = polygonize_noded_lines(connected_lines)
        self.assertEqual(
            find_endpoint_to_line_candidates(connected_paths, connected_noded, 3.0),
            [],
        )

    def test_geometry_fingerprint_ignores_line_direction_and_ring_start(self) -> None:
        forward = LineString([(0.0, 0.0), (1.25, 2.5), (4.0, 0.0)])
        backward = LineString(reversed(forward.coords))
        polygon = Polygon([(0.0, 0.0), (4.0, 0.0), (4.0, 4.0), (0.0, 0.0)])
        rotated = Polygon([(4.0, 0.0), (4.0, 4.0), (0.0, 0.0), (4.0, 0.0)])

        self.assertEqual(
            geometry_fingerprint(forward),
            geometry_fingerprint(backward),
        )
        self.assertEqual(
            geometry_fingerprint(polygon),
            geometry_fingerprint(rotated),
        )

    def test_lineage_collects_exact_and_tolerance_collinear_segments(self) -> None:
        derived = LineString([(0.0, 0.0), (5.0, 0.0), (10.0, 0.0)])
        source_ids = ["boundary-candidate-0001", "boundary-candidate-0002"]
        source_lines = [
            LineString([(0.0, 0.0), (5.0, 0.0)]),
            LineString([(5.0, 0.000005), (10.0, 0.000005)]),
        ]

        lineage = _source_candidate_ids(
            derived,
            source_ids,
            source_lines,
            STRtree(source_lines),
        )

        self.assertEqual(lineage, source_ids)

    def test_lineage_excludes_transverse_buffer_crossing(self) -> None:
        derived = LineString([(0.0, 0.0), (4.0, 0.0)])
        source_ids = ["boundary-candidate-0001", "boundary-candidate-0002"]
        source_lines = [
            LineString([(0.0, 0.0), (4.0, 0.0)]),
            LineString([(2.0, -1.0), (2.0, 1.0)]),
        ]

        lineage = _source_candidate_ids(
            derived,
            source_ids,
            source_lines,
            STRtree(source_lines),
        )

        self.assertEqual(lineage, ["boundary-candidate-0001"])


if __name__ == "__main__":
    unittest.main()
