/* Entry point.
 *
 * Module order below is the dependency order the bundler relies on:
 *   dates -> config -> model -> layout -> scene -> position -> gloss -> select -> controls
 * Nothing above imports anything below it, so the graph is acyclic. gloss.js is pure
 * HTML generation precisely so it does not need select.js back.
 */

import { position, applyTransform } from './position.js';
import { clampPanHere, deselect, hover, select } from './select.js';
import { buildScene, stage } from './scene.js';
import { fit } from './controls.js';

function boot() {
  if (!window.DATASET) {
    document.getElementById('gloss').textContent = 'No dataset — run build/merge.py.';
    return;
  }
  buildScene(select, hover);
  deselect();   // paints the empty gloss and lights nothing
  fit();

  // The axis rules span the viewport, and lane packing does not depend on width —
  // so a resize needs geometry rewritten but no relayout.
  new ResizeObserver(() => {
    position();
    clampPanHere();
    applyTransform();
  }).observe(stage);
}

boot();
