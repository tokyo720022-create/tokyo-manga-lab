import test from 'node:test';
import assert from 'node:assert/strict';
import { MAX_ZOOM, clampZoom, doubleTapTarget, formatZoom, isDoubleTap, isZoomed, pinchZoom, scrollToKeepFocus, stepZoom } from '../src/features/reader/reader-zoom.js';

test('zoom stays between fit-to-screen and the maximum, and tiny zooms snap back to fit', () => {
  assert.equal(clampZoom(0.2), 1);
  assert.equal(clampZoom(1.03), 1);
  assert.equal(clampZoom(2.345), 2.35);
  assert.equal(clampZoom(99), MAX_ZOOM);
  assert.equal(clampZoom(NaN), 1);
  assert.equal(clampZoom('abc'), 1);
  assert.equal(isZoomed(1.03), false);
  assert.equal(isZoomed(1.5), true);
});

test('buttons step in and out and come back to fit', () => {
  let zoom = 1;
  zoom = stepZoom(zoom, 1);
  assert.equal(zoom, 1.25);
  zoom = stepZoom(zoom, 1);
  assert.equal(zoom, 1.56);
  for (let i = 0; i < 20; i += 1) zoom = stepZoom(zoom, 1);
  assert.equal(zoom, MAX_ZOOM, 'cannot go past the maximum');
  for (let i = 0; i < 20; i += 1) zoom = stepZoom(zoom, -1);
  assert.equal(zoom, 1, 'zooming out ends at fit-to-screen');
});

test('pinching follows the distance between the fingers', () => {
  assert.equal(pinchZoom(1, 100, 200), 2);
  assert.equal(pinchZoom(2, 200, 100), 1);
  assert.equal(pinchZoom(2, 100, 1000), MAX_ZOOM);
  assert.equal(pinchZoom(1.5, 0, 100), 1.5, 'a bad start distance changes nothing');
});

test('double tap zooms in, or back out when already zoomed', () => {
  assert.equal(doubleTapTarget(1), 2.5);
  assert.equal(doubleTapTarget(2.5), 1);
  const first = { time: 1000, x: 100, y: 100 };
  assert.equal(isDoubleTap(first, 1200, 110, 105), true);
  assert.equal(isDoubleTap(first, 1500, 100, 100), false, 'too slow');
  assert.equal(isDoubleTap(first, 1100, 300, 100), false, 'too far apart');
  assert.equal(isDoubleTap(null, 1100, 100, 100), false);
});

test('the page point under the fingers stays under the fingers after zooming', () => {
  // viewport 400 wide, content 400 wide, fingers at 300 (75%). After zooming to 2x the content is 800 wide.
  const left = scrollToKeepFocus(0.75, 800, 300, 400);
  assert.equal(left, 300, '0.75 * 800 - 300');
  assert.equal(scrollToKeepFocus(0.99, 800, 0, 400), 400, 'never scrolls past the end');
  assert.equal(scrollToKeepFocus(0.01, 800, 390, 400), 0, 'never scrolls before the start');
});

test('the zoom label is a percentage', () => {
  assert.equal(formatZoom(1), '100%');
  assert.equal(formatZoom(2.5), '250%');
});
