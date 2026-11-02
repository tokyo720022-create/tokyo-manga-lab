// Reader zoom: the maths only (no page access), so it can be tested on its own.
export const MIN_ZOOM = 1;
export const MAX_ZOOM = 4;
export const DOUBLE_TAP_ZOOM = 2.5;
export const ZOOM_STEP = 1.25;
const SNAP_TO_FIT = 1.05;           // anything this close to fit-to-screen counts as not zoomed
const DOUBLE_TAP_MS = 300;
const DOUBLE_TAP_PX = 40;

export function clampZoom(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return MIN_ZOOM;
  const clamped = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, number));
  return clamped < SNAP_TO_FIT ? MIN_ZOOM : Math.round(clamped * 100) / 100;
}

export const isZoomed = zoom => clampZoom(zoom) > MIN_ZOOM;

// Zoom buttons: one step in (1) or out (-1).
export function stepZoom(zoom, direction) {
  const current = clampZoom(zoom);
  return clampZoom(direction > 0 ? current * ZOOM_STEP : current / ZOOM_STEP);
}

// Two fingers: the zoom follows how far apart they are compared with when they went down.
export function pinchZoom(startZoom, startDistance, distance) {
  if (!(startDistance > 0) || !(distance > 0)) return clampZoom(startZoom);
  return clampZoom(startZoom * (distance / startDistance));
}

export const doubleTapTarget = zoom => (isZoomed(zoom) ? MIN_ZOOM : DOUBLE_TAP_ZOOM);

// Is this tap the second half of a double tap? `previous` is { time, x, y } of the tap before (or null).
export function isDoubleTap(previous, now, x, y) {
  if (!previous || !(previous.time > 0)) return false;
  return now - previous.time <= DOUBLE_TAP_MS && Math.hypot(x - previous.x, y - previous.y) <= DOUBLE_TAP_PX;
}

// The point of the page under the fingers stays under the fingers: `anchor` is that point as a share (0..1) of the
// scrollable size before zooming, `focus` is where the fingers are inside the visible area.
export function scrollToKeepFocus(anchor, size, focus, viewport) {
  const target = anchor * size - focus;
  const max = Math.max(0, size - viewport);
  return Math.min(max, Math.max(0, target));
}

export const formatZoom = zoom => `${Math.round(clampZoom(zoom) * 100)}%`;
