"""Build review-only planar faces from validated vector-map linework.

This module is deliberately a build-time geometry worker.  The Node.js
orchestrator validates every persistent JSON document with JSON Schema before
starting this process and validates the final report afterwards.  The worker
therefore concentrates on the operations for which GEOS is the reliable
source of truth: Bézier flattening, endpoint replacement, line noding and
full polygonization diagnostics.

No object produced here is a runtime region.  Every bounded face remains an
anonymous review candidate until a human accepts the visual overlay.
"""

from __future__ import annotations

import hashlib
import json
import math
import platform
import sys
from collections.abc import Iterable
from typing import Any

import numpy
import shapely
from shapely import STRtree, get_parts, polygonize_full, unary_union
from shapely.geometry import LineString, Point, Polygon
from shapely.geometry.polygon import orient


MAX_INPUT_BYTES = 64 * 1024 * 1024
MAX_FLATTEN_DEPTH = 24
ROUND_DIGITS = 6
LINEAGE_OVERLAP_EPSILON_PX = 10 ** (-ROUND_DIGITS)
LINEAGE_DISTANCE_TOLERANCE_PX = 10 * LINEAGE_OVERLAP_EPSILON_PX


def _fail(message: str) -> None:
    """Stop before emitting a partial or potentially misleading result."""

    raise ValueError(message)


def _round(value: float) -> float:
    """Return stable JSON numbers and avoid the visually confusing ``-0.0``."""

    rounded = round(float(value), ROUND_DIGITS)
    return 0.0 if rounded == 0 else rounded


def _point_key(point: tuple[float, float]) -> tuple[float, float]:
    return (_round(point[0]), _round(point[1]))


def _fingerprint_payload(kind: str, value: Any) -> str:
    """Hash canonical rounded geometry evidence, not authorial meaning.

    Six decimal places are retained because that is the precision exposed by
    the review JSON.  The digest is stable for the same normalized build
    geometry, but deliberately changes when source geometry, flattening, snaps,
    or the geometry toolchain change.
    """

    canonical = json.dumps(
        {"kind": kind, "value": value},
        ensure_ascii=True,
        separators=(",", ":"),
        sort_keys=True,
    )
    return f"sha256:{hashlib.sha256(canonical.encode('ascii')).hexdigest()}"


def _apply_affine(
    matrix: dict[str, float], point: dict[str, float]
) -> tuple[float, float]:
    """Transform one PDF point into the canonical 5079 × 3627 design plane."""

    return (
        matrix["a"] * point["x"] + matrix["c"] * point["y"] + matrix["e"],
        matrix["b"] * point["x"] + matrix["d"] * point["y"] + matrix["f"],
    )


def _distance_to_chord(
    point: tuple[float, float],
    start: tuple[float, float],
    end: tuple[float, float],
) -> float:
    """Measure control-point distance to the infinite endpoint chord.

    A Bézier curve stays inside its control polygon.  Bounding both inner
    control points by the requested distance from the chord therefore gives a
    deterministic and conservative flatness criterion.
    """

    dx = end[0] - start[0]
    dy = end[1] - start[1]
    length = math.hypot(dx, dy)
    if length == 0:
        return math.hypot(point[0] - start[0], point[1] - start[1])
    return abs(dy * point[0] - dx * point[1] + end[0] * start[1] - end[1] * start[0]) / length


def _split_cubic(
    p0: tuple[float, float],
    p1: tuple[float, float],
    p2: tuple[float, float],
    p3: tuple[float, float],
) -> tuple[
    tuple[tuple[float, float], ...],
    tuple[tuple[float, float], ...],
]:
    """Split a cubic at t=0.5 using de Casteljau's exact affine construction."""

    def midpoint(
        left: tuple[float, float], right: tuple[float, float]
    ) -> tuple[float, float]:
        return ((left[0] + right[0]) / 2, (left[1] + right[1]) / 2)

    p01 = midpoint(p0, p1)
    p12 = midpoint(p1, p2)
    p23 = midpoint(p2, p3)
    p012 = midpoint(p01, p12)
    p123 = midpoint(p12, p23)
    p0123 = midpoint(p012, p123)
    return (p0, p01, p012, p0123), (p0123, p123, p23, p3)


def flatten_cubic(
    p0: tuple[float, float],
    p1: tuple[float, float],
    p2: tuple[float, float],
    p3: tuple[float, float],
    tolerance: float,
    *,
    depth: int = 0,
) -> list[tuple[float, float]]:
    """Approximate one cubic with a deterministic chord-error bound."""

    flatness = max(
        _distance_to_chord(p1, p0, p3),
        _distance_to_chord(p2, p0, p3),
    )
    if flatness <= tolerance:
        return [p0, p3]
    if depth >= MAX_FLATTEN_DEPTH:
        _fail(
            "cubic flattening exceeded the safe recursion limit before "
            f"reaching tolerance {tolerance}"
        )
    left, right = _split_cubic(p0, p1, p2, p3)
    left_points = flatten_cubic(*left, tolerance, depth=depth + 1)
    right_points = flatten_cubic(*right, tolerance, depth=depth + 1)
    return left_points[:-1] + right_points


def flatten_candidate(
    candidate: dict[str, Any],
    matrix: dict[str, float],
    tolerance: float,
) -> tuple[list[tuple[float, float]], bool]:
    """Flatten one validated M/L/C/Z PDF path in canonical coordinates."""

    points: list[tuple[float, float]] = []
    current: tuple[float, float] | None = None
    subpath_start: tuple[float, float] | None = None
    closed = False

    for command in candidate["pdfCommands"]:
        operation = command["op"]
        transformed = [_apply_affine(matrix, point) for point in command["points"]]
        if operation == "M":
            if points:
                _fail(f"{candidate['id']}: multiple subpaths are not supported")
            current = transformed[0]
            subpath_start = current
            points.append(current)
        elif operation == "L":
            if current is None:
                _fail(f"{candidate['id']}: L occurs before M")
            current = transformed[0]
            points.append(current)
        elif operation == "C":
            if current is None:
                _fail(f"{candidate['id']}: C occurs before M")
            flattened = flatten_cubic(
                current,
                transformed[0],
                transformed[1],
                transformed[2],
                tolerance,
            )
            points.extend(flattened[1:])
            current = transformed[2]
        elif operation == "Z":
            if current is None or subpath_start is None:
                _fail(f"{candidate['id']}: Z occurs before M")
            if points[-1] != subpath_start:
                points.append(subpath_start)
            current = subpath_start
            closed = True
        else:
            _fail(f"{candidate['id']}: unsupported command {operation}")

    deduplicated = [points[0]]
    for point in points[1:]:
        if point != deduplicated[-1]:
            deduplicated.append(point)
    if len(deduplicated) < 2:
        _fail(f"{candidate['id']}: flattening produced fewer than two points")
    return deduplicated, closed


def _endpoint_key(reference: dict[str, Any]) -> str:
    return f"{reference['candidateId']}:{reference['endpoint']}"


def apply_approved_endpoint_snaps(
    paths: dict[str, list[tuple[float, float]]],
    pairs: list[dict[str, Any]],
    threshold: float,
) -> list[dict[str, Any]]:
    """Replace only endpoints named by approved topology-review pairs.

    Union-find is used even though the current 15 pairs are disjoint.  This
    keeps the rule correct if a later reviewed topology explicitly describes a
    three-way node, without ever discovering or adding a connection itself.
    """

    parent: dict[str, str] = {}
    references: dict[str, dict[str, Any]] = {}

    def find(key: str) -> str:
        parent.setdefault(key, key)
        while parent[key] != key:
            parent[key] = parent[parent[key]]
            key = parent[key]
        return key

    def union(left: str, right: str) -> None:
        left_root = find(left)
        right_root = find(right)
        if left_root == right_root:
            return
        # Lexical roots make cluster construction independent from pair order.
        lower, upper = sorted((left_root, right_root))
        parent[upper] = lower

    for pair in pairs:
        left = pair["left"]
        right = pair["right"]
        left_key = _endpoint_key(left)
        right_key = _endpoint_key(right)
        if left_key == right_key:
            _fail(f"approved snap pair repeats endpoint {left_key}")
        for key, reference in ((left_key, left), (right_key, right)):
            if key in references and references[key] != reference:
                _fail(f"approved snap endpoint {key} has conflicting references")
            references[key] = reference
        union(left_key, right_key)

    clusters: dict[str, list[str]] = {}
    for key in sorted(references):
        clusters.setdefault(find(key), []).append(key)

    result = []
    for member_keys in sorted(clusters.values(), key=lambda members: tuple(members)):
        actual_points = []
        for key in member_keys:
            reference = references[key]
            candidate_id = reference["candidateId"]
            if candidate_id not in paths:
                _fail(f"approved snap references absent path {candidate_id}")
            endpoint_index = 0 if reference["endpoint"] == "start" else -1
            actual = paths[candidate_id][endpoint_index]
            reviewed = reference["point"]
            reviewed_distance = math.hypot(
                actual[0] - reviewed["x"], actual[1] - reviewed["y"]
            )
            if reviewed_distance > 0.001:
                _fail(
                    f"{key}: endpoint moved {reviewed_distance:.6f}px from the "
                    "schema-validated topology review"
                )
            actual_points.append(actual)

        # A cluster is replaced by one canonical centroid.  Only explicitly
        # reviewed endpoints participate; nearby unreviewed endpoints remain
        # byte-for-byte untouched.
        canonical = (
            sum(point[0] for point in actual_points) / len(actual_points),
            sum(point[1] for point in actual_points) / len(actual_points),
        )
        maximum_displacement = 0.0
        members = []
        for key, original in zip(member_keys, actual_points, strict=True):
            reference = references[key]
            endpoint_index = 0 if reference["endpoint"] == "start" else -1
            paths[reference["candidateId"]][endpoint_index] = canonical
            maximum_displacement = max(
                maximum_displacement,
                math.hypot(original[0] - canonical[0], original[1] - canonical[1]),
            )
            members.append(
                {
                    "candidateId": reference["candidateId"],
                    "endpoint": reference["endpoint"],
                    "originalPoint": _point_json(original),
                }
            )
        if maximum_displacement > threshold:
            _fail(
                "approved endpoint cluster exceeds the configured "
                f"{threshold}px snap threshold"
            )
        result.append(
            {
                "members": members,
                "canonicalPoint": _point_json(canonical),
                "maximumDisplacementPx": _round(maximum_displacement),
            }
        )
    return result


def _recursive_parts(geometry: Any, accepted_types: set[str]) -> list[Any]:
    """Flatten Shapely collections without assuming a particular union type."""

    if geometry.is_empty:
        return []
    if geometry.geom_type in accepted_types:
        return [geometry]
    parts: list[Any] = []
    for child in get_parts(geometry):
        if child is geometry:
            _fail(f"cannot decompose unexpected geometry type {geometry.geom_type}")
        parts.extend(_recursive_parts(child, accepted_types))
    return parts


def polygonize_noded_lines(
    lines: Iterable[LineString],
) -> tuple[list[Polygon], list[Any], list[Any], list[Any], list[LineString]]:
    """Node line intersections and return all ``polygonize_full`` channels."""

    noded = unary_union(list(lines))
    noded_lines = _recursive_parts(noded, {"LineString", "LinearRing"})
    polygons, cuts, dangles, invalids = polygonize_full(noded_lines)
    return (
        _recursive_parts(polygons, {"Polygon"}),
        _recursive_parts(cuts, {"LineString", "LinearRing"}),
        _recursive_parts(dangles, {"LineString", "LinearRing"}),
        _recursive_parts(invalids, {"LineString", "LinearRing"}),
        noded_lines,
    )


def _point_json(point: tuple[float, float]) -> dict[str, float]:
    return {"x": _round(point[0]), "y": _round(point[1])}


def _bounds_json(geometry: Any) -> dict[str, float]:
    min_x, min_y, max_x, max_y = geometry.bounds
    return {
        "minX": _round(min_x),
        "minY": _round(min_y),
        "maxX": _round(max_x),
        "maxY": _round(max_y),
    }


def _canonical_ring(coordinates: Iterable[tuple[float, float]]) -> list[list[float]]:
    """Rotate a closed ring to its lexical minimum for stable serialization."""

    points = [_point_key(point) for point in coordinates]
    if len(points) < 4 or points[0] != points[-1]:
        _fail("polygonizer produced an invalid open ring")
    body = points[:-1]
    minimum_index = min(range(len(body)), key=lambda index: body[index])
    rotated = body[minimum_index:] + body[:minimum_index]
    rotated.append(rotated[0])
    return [[point[0], point[1]] for point in rotated]


def _polygon_json(polygon: Polygon) -> dict[str, Any]:
    canonical = orient(polygon, sign=1.0)
    interior_rings = sorted(
        _canonical_ring(interior.coords) for interior in canonical.interiors
    )
    return {
        "type": "Polygon",
        "coordinates": [
            _canonical_ring(canonical.exterior.coords),
            *interior_rings,
        ],
    }


def _canonical_line(coordinates: Iterable[tuple[float, float]]) -> list[list[float]]:
    """Normalize line direction, and ring rotation when a diagnostic is closed."""

    points = [_point_key(point) for point in coordinates]
    if len(points) < 2:
        _fail("polygonizer produced a diagnostic line with fewer than two points")
    if points[0] == points[-1]:
        body = points[:-1]
        rotations = []
        for direction in (body, list(reversed(body))):
            for index in range(len(direction)):
                rotations.append(direction[index:] + direction[:index])
        canonical = min(rotations)
        canonical = canonical + [canonical[0]]
    else:
        reversed_points = list(reversed(points))
        canonical = min(points, reversed_points)
    return [[point[0], point[1]] for point in canonical]


def geometry_fingerprint(geometry: Any) -> str:
    """Return an orientation-independent fingerprint for supported geometry."""

    if geometry.geom_type == "Polygon":
        return _fingerprint_payload("Polygon", _polygon_json(geometry)["coordinates"])
    if geometry.geom_type in {"LineString", "LinearRing"}:
        return _fingerprint_payload("LineString", _canonical_line(geometry.coords))
    _fail(f"cannot fingerprint unsupported geometry type {geometry.geom_type}")


def _source_candidate_ids(
    geometry: Any,
    source_segment_ids: list[str],
    source_segments: list[LineString],
    source_segment_tree: STRtree,
) -> list[str]:
    """Find source paths sharing collinear line length with derived geometry.

    Point-only contact is intentionally ignored: it does not prove that a
    source path contributed an edge.  Lineage is evaluated for each derived
    segment, so one exact contributor cannot hide another contributor displaced
    only by bounded GEOS numerical dust.
    """

    lineage_geometry = geometry.boundary if geometry.geom_type == "Polygon" else geometry
    matches: set[str] = set()
    for derived_line in _recursive_parts(
        lineage_geometry, {"LineString", "LinearRing"}
    ):
        derived_coordinates = list(derived_line.coords)
        for derived_start, derived_end in zip(
            derived_coordinates, derived_coordinates[1:], strict=False
        ):
            derived_segment = LineString([derived_start, derived_end])
            if derived_segment.length <= LINEAGE_OVERLAP_EPSILON_PX:
                continue
            query_geometry = derived_segment.buffer(
                LINEAGE_DISTANCE_TOLERANCE_PX,
                cap_style="square",
                join_style="mitre",
            )
            for source_index in source_segment_tree.query(query_geometry):
                source_segment = source_segments[int(source_index)]
                source_start, source_end = source_segment.coords
                if _collinear_overlap_length(
                    derived_start,
                    derived_end,
                    source_start,
                    source_end,
                ) > LINEAGE_OVERLAP_EPSILON_PX:
                    matches.add(source_segment_ids[int(source_index)])
    return sorted(matches)


def _build_source_segment_index(
    source_ids: list[str],
    source_lines: list[LineString],
) -> tuple[list[str], list[LineString], STRtree]:
    """Index flattened source segments once for bounded repeated lineage lookup."""

    segment_ids = []
    segments = []
    for source_id, source_line in zip(source_ids, source_lines, strict=True):
        coordinates = list(source_line.coords)
        for start, end in zip(coordinates, coordinates[1:], strict=False):
            segment = LineString([start, end])
            if segment.length <= LINEAGE_OVERLAP_EPSILON_PX:
                continue
            segment_ids.append(source_id)
            segments.append(segment)
    if not segments:
        _fail("source lineage index contains no positive-length segments")
    return segment_ids, segments, STRtree(segments)


def _collinear_overlap_length(
    derived_start: tuple[float, float],
    derived_end: tuple[float, float],
    source_start: tuple[float, float],
    source_end: tuple[float, float],
) -> float:
    """Measure positive projected overlap only for tolerance-collinear segments.

    The positional test is applied at both ends of the projected overlap.  A
    transverse crossing therefore has zero lineage even though the source
    segment intersects a narrow buffer around the derived segment.
    """

    derived_dx = derived_end[0] - derived_start[0]
    derived_dy = derived_end[1] - derived_start[1]
    source_dx = source_end[0] - source_start[0]
    source_dy = source_end[1] - source_start[1]
    derived_length = math.hypot(derived_dx, derived_dy)
    source_length = math.hypot(source_dx, source_dy)
    if (
        derived_length <= LINEAGE_OVERLAP_EPSILON_PX
        or source_length <= LINEAGE_OVERLAP_EPSILON_PX
    ):
        return 0.0

    unit_x = derived_dx / derived_length
    unit_y = derived_dy / derived_length

    def projected_distance(point: tuple[float, float]) -> float:
        return (
            (point[0] - derived_start[0]) * unit_x
            + (point[1] - derived_start[1]) * unit_y
        )

    source_projection_start = projected_distance(source_start)
    source_projection_end = projected_distance(source_end)
    projection_delta = source_projection_end - source_projection_start
    if abs(projection_delta) <= LINEAGE_OVERLAP_EPSILON_PX:
        return 0.0
    overlap_start = max(
        0.0, min(source_projection_start, source_projection_end)
    )
    overlap_end = min(
        derived_length, max(source_projection_start, source_projection_end)
    )
    overlap_length = overlap_end - overlap_start
    if overlap_length <= LINEAGE_OVERLAP_EPSILON_PX:
        return 0.0

    # Bound directional divergence over the shorter segment in pixel units
    # rather than accepting any line that merely crosses the tolerance buffer.
    normalized_cross = abs(
        derived_dx * source_dy - derived_dy * source_dx
    ) / (derived_length * source_length)
    if (
        normalized_cross * min(derived_length, source_length)
        > LINEAGE_DISTANCE_TOLERANCE_PX
    ):
        return 0.0

    for overlap_position in (overlap_start, overlap_end):
        source_fraction = (
            overlap_position - source_projection_start
        ) / projection_delta
        source_point = (
            source_start[0] + source_fraction * source_dx,
            source_start[1] + source_fraction * source_dy,
        )
        perpendicular_distance = abs(
            derived_dx * (source_point[1] - derived_start[1])
            - derived_dy * (source_point[0] - derived_start[0])
        ) / derived_length
        if perpendicular_distance > LINEAGE_DISTANCE_TOLERANCE_PX:
            return 0.0
    return overlap_length


def _line_json(
    line: Any,
    index: int,
    prefix: str,
    source_segment_ids: list[str],
    source_segments: list[LineString],
    source_segment_tree: STRtree,
) -> dict[str, Any]:
    coordinates = _canonical_line(line.coords)
    return {
        "id": f"{prefix}-{index:04d}",
        "geometryFingerprint": geometry_fingerprint(line),
        "sourceCandidateIds": _source_candidate_ids(
            line,
            source_segment_ids,
            source_segments,
            source_segment_tree,
        ),
        "lengthPx": _round(line.length),
        "bounds": _bounds_json(line),
        "coordinates": coordinates,
    }


def find_endpoint_to_line_candidates(
    paths: dict[str, list[tuple[float, float]]],
    noded_lines: Iterable[LineString],
    threshold: float,
) -> list[dict[str, Any]]:
    """Report degree-one endpoints near another source path's strict interior.

    These are review hints only.  Projection is used to measure the gap, but
    neither the endpoint nor the target line is changed.  Target endpoints are
    excluded because endpoint-to-endpoint review is owned by the preceding
    topology artifact.
    """

    path_ids = sorted(paths)
    path_lines = [LineString(paths[candidate_id]) for candidate_id in path_ids]
    path_tree = STRtree(path_lines)
    noded_degree: dict[tuple[float, float], int] = {}
    for line in noded_lines:
        for coordinate in (line.coords[0], line.coords[-1]):
            key = _point_key(coordinate)
            noded_degree[key] = noded_degree.get(key, 0) + 1

    candidates = []
    for endpoint_source_id in path_ids:
        points = paths[endpoint_source_id]
        for endpoint_name, endpoint in (("start", points[0]), ("end", points[-1])):
            endpoint_key = _point_key(endpoint)
            if noded_degree.get(endpoint_key, 0) != 1:
                continue
            endpoint_point = Point(endpoint)
            query_bounds = endpoint_point.buffer(threshold, cap_style="square")
            for path_index in path_tree.query(query_bounds):
                line_source_id = path_ids[int(path_index)]
                if line_source_id == endpoint_source_id:
                    continue
                target_line = path_lines[int(path_index)]
                projected_distance = target_line.project(endpoint_point)
                # A projection onto either target endpoint belongs to the
                # endpoint-to-endpoint review, even when the gap is small.
                if (
                    projected_distance <= LINEAGE_OVERLAP_EPSILON_PX
                    or target_line.length - projected_distance
                    <= LINEAGE_OVERLAP_EPSILON_PX
                ):
                    continue
                projected = target_line.interpolate(projected_distance)
                gap = endpoint_point.distance(projected)
                if gap > threshold:
                    continue
                endpoint_json = _point_json(endpoint)
                projected_json = _point_json((projected.x, projected.y))
                evidence = {
                    "endpointSourceCandidateId": endpoint_source_id,
                    "endpoint": endpoint_name,
                    "lineSourceCandidateId": line_source_id,
                    "endpointPoint": endpoint_json,
                    "projectedPoint": projected_json,
                    "distancePx": _round(gap),
                }
                evidence["geometryFingerprint"] = _fingerprint_payload(
                    "EndpointToLineProximity",
                    evidence,
                )
                candidates.append(evidence)

    candidates.sort(
        key=lambda item: (
            item["distancePx"],
            item["endpointSourceCandidateId"],
            item["endpoint"],
            item["lineSourceCandidateId"],
            item["geometryFingerprint"],
        )
    )
    for index, candidate in enumerate(candidates, start=1):
        candidate["id"] = f"endpoint-to-line-{index:04d}"
    return candidates


def _sorted_lines(lines: Iterable[Any]) -> list[Any]:
    return sorted(
        lines,
        key=lambda line: (
            _round(line.bounds[1]),
            _round(line.bounds[0]),
            _round(line.bounds[3]),
            _round(line.bounds[2]),
            _round(line.length),
            tuple(_point_key(point) for point in line.coords),
        ),
    )


def _face_sort_key(polygon: Polygon) -> tuple[Any, ...]:
    representative = polygon.representative_point()
    return (
        _round(representative.y),
        _round(representative.x),
        _round(polygon.area),
        _canonical_ring(orient(polygon, sign=1.0).exterior.coords),
    )


def build_geometry_result(payload: dict[str, Any]) -> dict[str, Any]:
    """Execute the bounded review pipeline on an orchestrator-validated input."""

    tolerance = float(payload["flattenTolerancePx"])
    threshold = float(payload["snapThresholdPx"])
    if not 0 < tolerance <= 0.25:
        _fail("flattenTolerancePx must be greater than 0 and at most 0.25")
    if not 0 < threshold <= 3:
        _fail("snapThresholdPx must be greater than 0 and at most 3")

    matrix = payload["pdfToCanonical"]
    flattened_paths: dict[str, list[tuple[float, float]]] = {}
    for candidate in payload["includedCandidates"]:
        points, closed = flatten_candidate(candidate, matrix, tolerance)
        if closed:
            _fail(f"{candidate['id']}: included line unexpectedly closes with Z")
        flattened_paths[candidate["id"]] = points

    snaps = apply_approved_endpoint_snaps(
        flattened_paths,
        payload["approvedEndpointPairs"],
        threshold,
    )
    held_candidate = payload["excludedClosedContour"]
    held_points, held_closed = flatten_candidate(held_candidate, matrix, tolerance)
    if not held_closed:
        _fail(f"{held_candidate['id']}: excluded internal contour is not closed")
    held_polygon = Polygon(held_points)
    if not held_polygon.is_valid or held_polygon.is_empty or held_polygon.area <= 0:
        _fail(f"{held_candidate['id']}: excluded internal contour is not a valid polygon")

    included_lines = [
        LineString(flattened_paths[candidate["id"]])
        for candidate in payload["includedCandidates"]
    ]
    all_lines = included_lines + [LineString(held_points)]
    polygons, cuts, dangles, invalids, noded_lines = polygonize_noded_lines(all_lines)
    source_ids = [
        candidate["id"] for candidate in payload["includedCandidates"]
    ] + [held_candidate["id"]]
    (
        source_segment_ids,
        source_segments,
        source_segment_tree,
    ) = _build_source_segment_index(source_ids, all_lines)
    endpoint_to_line_candidates = find_endpoint_to_line_candidates(
        flattened_paths,
        noded_lines,
        threshold,
    )

    excluded_faces = []
    candidate_faces = []
    for polygon in polygons:
        representative = polygon.representative_point()
        if held_polygon.covers(representative):
            excluded_faces.append(polygon)
        else:
            candidate_faces.append(polygon)
    candidate_faces.sort(key=_face_sort_key)
    excluded_faces.sort(key=_face_sort_key)

    regions = []
    for index, polygon in enumerate(candidate_faces, start=1):
        representative = polygon.representative_point()
        regions.append(
            {
                "id": f"region-candidate-{index:04d}",
                "reviewStatus": "candidate",
                "authorConfirmed": False,
                "geometryFingerprint": geometry_fingerprint(polygon),
                "sourceCandidateIds": _source_candidate_ids(
                    polygon,
                    source_segment_ids,
                    source_segments,
                    source_segment_tree,
                ),
                "areaPx2": _round(polygon.area),
                "bounds": _bounds_json(polygon),
                "representativePoint": _point_json((representative.x, representative.y)),
                "interiorRingCount": len(polygon.interiors),
                "geometry": _polygon_json(polygon),
            }
        )

    sorted_cuts = _sorted_lines(cuts)
    sorted_dangles = _sorted_lines(dangles)
    sorted_invalids = _sorted_lines(invalids)
    excluded_ids = [
        f"excluded-face-{index:04d}" for index in range(1, len(excluded_faces) + 1)
    ]
    excluded_space = {
        "sourceCandidateId": held_candidate["id"],
        "interpretation": "impassable-internal-space-review-assumption",
        "authorConfirmed": False,
        "geometryFingerprint": geometry_fingerprint(held_polygon),
        "areaPx2": _round(held_polygon.area),
        "bounds": _bounds_json(held_polygon),
        "matchedPolygonizedFaceIds": excluded_ids,
        "geometry": _polygon_json(held_polygon),
    }

    hole_count = sum(len(polygon.interiors) for polygon in candidate_faces)
    blocking_findings = []
    if hole_count:
        blocking_findings.append(
            {
                "id": "candidate-regions-contain-holes",
                "kind": "architecture-review-required",
                "message": (
                    f"{hole_count} interior rings occur in candidate regions; "
                    "the current simple-region contract must not be changed automatically."
                ),
            }
        )
    if len(candidate_faces) > 512:
        blocking_findings.append(
            {
                "id": "candidate-region-limit-exceeded",
                "kind": "architecture-review-required",
                "message": (
                    f"{len(candidate_faces)} candidate regions exceed the current "
                    "limit of 512."
                ),
            }
        )
    if sorted_dangles or sorted_invalids:
        blocking_findings.append(
            {
                "id": "linework-requires-additional-review",
                "kind": "geometry-review-required",
                "message": (
                    f"polygonize_full returned {len(sorted_dangles)} dangles and "
                    f"{len(sorted_invalids)} invalid rings; no new connection was invented."
                ),
            }
        )

    flattened_segment_count = sum(
        len(points) - 1 for points in flattened_paths.values()
    ) + len(held_points) - 1
    return {
        "toolchain": {
            "python": platform.python_version(),
            "numpy": numpy.__version__,
            "shapely": shapely.__version__,
            "geos": shapely.geos_version_string,
        },
        "summary": {
            "includedPathCount": len(included_lines),
            "excludedClosedContourCount": 1,
            "approvedSnapPairCount": len(payload["approvedEndpointPairs"]),
            "snapClusterCount": len(snaps),
            "flattenedSegmentCount": flattened_segment_count,
            "nodedLineCount": len(noded_lines),
            "polygonizedFaceCount": len(polygons),
            "candidateRegionCount": len(regions),
            "excludedInternalFaceCount": len(excluded_faces),
            "cutEdgeCount": len(sorted_cuts),
            "dangleCount": len(sorted_dangles),
            "invalidRingCount": len(sorted_invalids),
            "endpointToLineCandidateCount": len(endpoint_to_line_candidates),
            "candidateInteriorRingCount": hole_count,
            "candidateMultiPolygonCount": 0,
            "blockingFindingCount": len(blocking_findings),
        },
        "snapClusters": snaps,
        "candidateRegions": regions,
        "excludedSpaces": [excluded_space],
        "diagnostics": {
            "cuts": [
                _line_json(
                    line,
                    index,
                    "cut",
                    source_segment_ids,
                    source_segments,
                    source_segment_tree,
                )
                for index, line in enumerate(sorted_cuts, start=1)
            ],
            "dangles": [
                _line_json(
                    line,
                    index,
                    "dangle",
                    source_segment_ids,
                    source_segments,
                    source_segment_tree,
                )
                for index, line in enumerate(sorted_dangles, start=1)
            ],
            "invalidRings": [
                _line_json(
                    line,
                    index,
                    "invalid-ring",
                    source_segment_ids,
                    source_segments,
                    source_segment_tree,
                )
                for index, line in enumerate(sorted_invalids, start=1)
            ],
            "endpointToLineCandidates": endpoint_to_line_candidates,
        },
        "blockingFindings": blocking_findings,
    }


def main() -> None:
    """Read one bounded JSON request from stdin and emit one JSON response."""

    raw = sys.stdin.buffer.read(MAX_INPUT_BYTES + 1)
    if len(raw) > MAX_INPUT_BYTES:
        _fail(f"worker input exceeds the safe {MAX_INPUT_BYTES}-byte limit")
    payload = json.loads(raw.decode("utf-8"))
    result = build_geometry_result(payload)
    sys.stdout.write(json.dumps(result, ensure_ascii=False, separators=(",", ":")))
    sys.stdout.write("\n")


if __name__ == "__main__":
    try:
        main()
    except Exception as error:  # noqa: BLE001 - CLI must fail closed with context.
        sys.stderr.write(f"{type(error).__name__}: {error}\n")
        raise SystemExit(1) from error
