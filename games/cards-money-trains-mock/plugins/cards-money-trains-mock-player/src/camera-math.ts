/**
 * Pure camera calculations for the Cards Money Trains mock world.
 *
 * This is deliberately game-owned rather than platform-owned: the host only
 * supplies Phaser, while this mock plugin proves the same public camera
 * behaviour with replaceable test content. The calculations stay browser-free
 * so they can be verified without WebGL or a DOM.
 */

export interface CameraPoint {
  readonly x: number;
  readonly y: number;
}

export interface CameraSize {
  readonly width: number;
  readonly height: number;
}

export interface CameraWorld extends CameraSize {
  readonly x: number;
  readonly y: number;
}

export interface CameraView {
  readonly scrollX: number;
  readonly scrollY: number;
  readonly zoom: number;
}

export interface CameraZoomLimits {
  readonly min: number;
  readonly max: number;
}

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

const safeDimension = (value: number) => Math.max(1, value);

/** Return the largest undistorted zoom that still shows the complete world. */
export function fitCameraZoom(viewport: CameraSize, world: CameraSize): number {
  return Math.min(
    safeDimension(viewport.width) / safeDimension(world.width),
    safeDimension(viewport.height) / safeDimension(world.height)
  );
}

/** Match Phaser's centred-camera bounds for one axis. */
function clampScrollAxis(
  value: number,
  viewportSize: number,
  worldStart: number,
  worldSize: number,
  zoom: number
): number {
  const visibleSize = safeDimension(viewportSize) / zoom;
  const minScroll = worldStart + (visibleSize - safeDimension(viewportSize)) / 2;
  const maxScroll = minScroll + Math.max(0, worldSize - visibleSize);
  return clamp(value, minScroll, maxScroll);
}

/** Clamp a view to the declared world without changing its zoom. */
export function clampCameraView(
  view: CameraView,
  viewport: CameraSize,
  world: CameraWorld
): CameraView {
  const zoom = Math.max(Number.EPSILON, view.zoom);
  return {
    scrollX: clampScrollAxis(view.scrollX, viewport.width, world.x, world.width, zoom),
    scrollY: clampScrollAxis(view.scrollY, viewport.height, world.y, world.height, zoom),
    zoom
  };
}

/** Build the reproducible “show the whole map” view. */
export function overviewCameraView(
  viewport: CameraSize,
  world: CameraWorld
): CameraView {
  const zoom = fitCameraZoom(viewport, world);
  return clampCameraView({
    scrollX: world.x + world.width / 2 - viewport.width / 2,
    scrollY: world.y + world.height / 2 - viewport.height / 2,
    zoom
  }, viewport, world);
}

/** Zoom around a screen point while keeping its world coordinate stable. */
export function zoomCameraViewAtPoint(
  view: CameraView,
  pointer: CameraPoint,
  requestedZoom: number,
  viewport: CameraSize,
  world: CameraWorld,
  limits: CameraZoomLimits
): CameraView {
  const zoom = clamp(requestedZoom, limits.min, limits.max);
  const originX = viewport.width / 2;
  const originY = viewport.height / 2;
  const worldX = view.scrollX + originX + (pointer.x - originX) / view.zoom;
  const worldY = view.scrollY + originY + (pointer.y - originY) / view.zoom;

  return clampCameraView({
    scrollX: worldX - originX - (pointer.x - originX) / zoom,
    scrollY: worldY - originY - (pointer.y - originY) / zoom,
    zoom
  }, viewport, world);
}

/** Move the world with a drag gesture, expressed in screen pixels. */
export function panCameraViewBy(
  view: CameraView,
  screenDelta: CameraPoint,
  viewport: CameraSize,
  world: CameraWorld
): CameraView {
  return clampCameraView({
    scrollX: view.scrollX - screenDelta.x / view.zoom,
    scrollY: view.scrollY - screenDelta.y / view.zoom,
    zoom: view.zoom
  }, viewport, world);
}

/** Preserve the world point at the viewport centre after a logical resize. */
export function resizeCameraView(
  view: CameraView,
  previousViewport: CameraSize,
  nextViewport: CameraSize,
  world: CameraWorld
): CameraView {
  const centreX = view.scrollX + previousViewport.width / 2;
  const centreY = view.scrollY + previousViewport.height / 2;
  return clampCameraView({
    scrollX: centreX - nextViewport.width / 2,
    scrollY: centreY - nextViewport.height / 2,
    zoom: view.zoom
  }, nextViewport, world);
}
