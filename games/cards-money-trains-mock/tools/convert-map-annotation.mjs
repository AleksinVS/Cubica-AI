#!/usr/bin/env node
/**
 * Cards, Money, Trains adapter for the shared map-annotation pipeline.
 *
 * Validation, cross-reference checks, geometry and SVG rendering live in the
 * shared module. This file owns only the game's accepted transport settings
 * and its command-line entry point. Construction prices remain in the game
 * rules and Mechanics plans rather than leaking into the graph model.
 */

import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  createMapAnnotationReviewOverlaySvg,
  createTransportManifestFragment,
  runMapAnnotationCli,
  validateMapAnnotation
} from "../../../scripts/map-annotation/map-annotation.mjs";

const scriptFile = fileURLToPath(import.meta.url);

/**
 * Settings already present in this game's generated fragment before the
 * shared refactor. They remain game-local and do not change runtime contracts.
 */
const transportManifestOptions = Object.freeze({
  networkId: "main",
  visibility: "public",
  nodeCollection: "networkNodes",
  edgeCollection: "networkEdges",
  terminalObjectType: "transport.terminal",
  waypointObjectType: "transport.waypoint",
  edgeObjectType: "transport.edge",
  nodeStateFacet: "availability",
  buildableNodeStates: ["open"],
  edgeStateFacet: "state",
  splittableEdgeStates: ["open", "building"],
  builtEdgeState: "building",
  sequenceEndpoint: "public.transportNetworks.main.sequence",
  // The synthetic rectangles are intentionally exact enough to exercise the
  // general server planner before author-confirmed country contours arrive.
  roadPlanning: {
    geometryVersion: "mock-regions-v1",
    excludedRegionIdsEndpoint: "public.transportNetworks.main.excludedRegionIds"
  },
  initialSequence: 1000,
  allowedAnnotationStatuses: ["mock"]
});

// Preserve the game-local import names used by the package builder and tests.
// Their implementation is shared, so there is no second validation pipeline.
export const validateAnnotation = validateMapAnnotation;
export const toReviewOverlaySvg = createMapAnnotationReviewOverlaySvg;
export const toManifestFragment = (annotation) =>
  createTransportManifestFragment(annotation, transportManifestOptions);

if (process.argv[1] && path.resolve(process.argv[1]) === scriptFile) {
  runMapAnnotationCli({
    argv: process.argv,
    fragmentFactory: toManifestFragment,
    commandName: "convert-map-annotation.mjs"
  }).catch((error) => {
    process.stderr.write(`map-annotation: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
