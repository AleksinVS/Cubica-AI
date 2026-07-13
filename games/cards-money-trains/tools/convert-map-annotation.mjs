#!/usr/bin/env node
/**
 * Game-local command for the shared map-annotation intake pipeline.
 *
 * The shared module validates coordinates, references and review status. This
 * adapter owns only accepted Cards, Money, Trains settings such as object
 * types and construction costs, so the generic importer never invents game
 * rules from pixels.
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
  sequencePath: "/public/transportNetworks/main/sequence",
  roadCostPerRegionSegment: 2,
  waypointCost: 5,
  // This block becomes runtime content only after the authoring annotation is
  // explicitly promoted to author-confirmed; review-draft geometry is rejected.
  roadPlanning: {
    geometryVersion: "guinea-regions-v1",
    excludedRegionIdsPath: "/public/transportNetworks/main/excludedRegionIds"
  },
  initialSequence: 1000,
  allowedAnnotationStatuses: ["author-confirmed"]
});

// These aliases keep game-specific tests and future builders on the same
// shared implementation instead of growing a second validation pipeline.
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
