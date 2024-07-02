import {directionEnabled, debounce, keyNotPressed, getModifierKey, keyPressed} from './utils';
import {zoom, zoomRect} from './core';
import {callback as call, getRelativePosition} from 'chart.js/helpers';
import {getState, DRAG_MODE} from './state';

function removeHandler(chart, type) {
  const {handlers} = getState(chart);
  const handler = handlers[type];
  if (handler && handler.target) {
    handler.target.removeEventListener(type, handler);
    delete handlers[type];
  }
}

function addHandler(chart, target, type, handler) {
  const {handlers, options} = getState(chart);
  const oldHandler = handlers[type];
  if (oldHandler && oldHandler.target === target) {
    // already attached
    return;
  }
  removeHandler(chart, type);
  handlers[type] = (event) => handler(chart, event, options);
  handlers[type].target = target;
  target.addEventListener(type, handlers[type]);
}

export function mouseMove(chart, event) {
  const state = getState(chart);
  if (state.dragStart) {
    state.dragging = true;
    state.dragEnd = event;
    chart.update('none');
  }
}

function keyDown(chart, event) {
  const state = getState(chart);
  if (!state.dragStart || event.key !== 'Escape') {
    return;
  }

  removeHandler(chart, 'keydown');
  state.dragging = false;
  state.dragStart = state.dragEnd = null;
  chart.update('none');
}

function zoomStart(chart, event, zoomOptions) {
  const {onZoomStart, onZoomRejected} = zoomOptions;
  if (onZoomStart) {
    const point = getRelativePosition(event, chart);
    if (call(onZoomStart, [{chart, event, point}]) === false) {
      call(onZoomRejected, [{chart, event}]);
      return false;
    }
  }
}

export function mouseDown(chart, event) {
  const state = getState(chart);
  const {pan: panOptions, zoom: zoomOptions = {}, range: rangeOptions = {}} = state.options;

  if (
    event.button !== 0 ||
    keyPressed(getModifierKey(panOptions), event) ||
    (keyNotPressed(getModifierKey(rangeOptions), event) && keyNotPressed(getModifierKey(zoomOptions.drag), event))
  ) {
    return call(zoomOptions.onZoomRejected, [{chart, event}]);
  }

  if (zoomStart(chart, event, zoomOptions) === false) {
    return;
  }

  // TODO: check if modifierKey duplicated

  // set mode for "drag" operation
  if (keyPressed(getModifierKey(zoomOptions.drag), event)) {
    state.dragMode = DRAG_MODE.DRAG;
  } else if (keyPressed(getModifierKey(rangeOptions), event)) {
    state.dragMode = DRAG_MODE.RANGE;
  }

  state.dragStart = event;

  addHandler(chart, chart.canvas, 'mousemove', mouseMove);
  addHandler(chart, window.document, 'keydown', keyDown);
}

export function computeDragRect(chart, mode, dragMode, mirroring, beginPointEvent, endPointEvent) {
  const xEnabled = directionEnabled(mode, 'x', chart);
  const yEnabled = directionEnabled(mode, 'y', chart);
  let {top, left, right, bottom, width: chartWidth, height: chartHeight} = chart.chartArea;

  const beginPoint = getRelativePosition(beginPointEvent, chart);
  const endPoint = getRelativePosition(endPointEvent, chart);

  if (xEnabled) {
    left = Math.min(beginPoint.x, endPoint.x);
    right = Math.max(beginPoint.x, endPoint.x);
  }

  if (yEnabled) {
    top = Math.min(beginPoint.y, endPoint.y);
    bottom = Math.max(beginPoint.y, endPoint.y);
  }
  let width = right - left;
  let height = bottom - top;

  if (dragMode === DRAG_MODE.RANGE) {
    if (xEnabled && mirroring) {
      if (beginPoint.x < endPoint.x) {
        left = left - width;
      } else {
        right = right + width;
      }
      width += width;
    }

    if (yEnabled && mirroring) {
      if (beginPoint.y < endPoint.y) {
        top = top - height;
      } else {
        bottom = bottom + height;
      }
      height += height;
    }
  }

  const retVal = {
    left,
    top,
    right,
    bottom,
    width,
    height,
    zoomX: xEnabled && width ? 1 + (chartWidth - width) / chartWidth : 1,
    zoomY: yEnabled && height ? 1 + (chartHeight - height) / chartHeight : 1
  };

  if (dragMode === DRAG_MODE.RANGE) {
    // TODO: check if out of plot area
    const leftDataIndex = chart.scales.x.getValueForPixel(left);
    const rightDataIndex = chart.scales.x.getValueForPixel(right);
    const topDataIndex = chart.scales.y.getValueForPixel(top);
    const bottomDataIndex = chart.scales.y.getValueForPixel(bottom);

    retVal.rangeDataIndex = {
      x: {
        left: leftDataIndex,
        right: rightDataIndex
      },
      y: {
        top: topDataIndex,
        bottom: bottomDataIndex
      }
    };
  }

  return retVal;
}

export function mouseUp(chart, event) {
  const state = getState(chart);
  if (!state.dragStart) {
    return;
  }

  removeHandler(chart, 'mousemove');
  const {
    mode: zoomMode,
    onZoomComplete,
    drag: {threshold = 0}
  } = state.options.zoom;

  const {mode: rangeMode, mirroring, onRangeSelected} = state.options.range;

  const mode = state.dragMode === DRAG_MODE.RANGE ? rangeMode : zoomMode;

  const rect = computeDragRect(chart, mode, state.dragMode, mirroring, state.dragStart, event);
  const distanceX = directionEnabled(mode, 'x', chart) ? rect.width : 0;
  const distanceY = directionEnabled(mode, 'y', chart) ? rect.height : 0;
  const distance = Math.sqrt(distanceX * distanceX + distanceY * distanceY);

  // Remove drag start and end before chart update to stop drawing selected area
  state.dragStart = state.dragEnd = null;

  if (distance <= threshold) {
    state.dragging = false;
    state.dragMode = null;
    chart.update('none');
    return;
  }

  if (state.dragMode === DRAG_MODE.DRAG) {
    zoomRect(chart, {x: rect.left, y: rect.top}, {x: rect.right, y: rect.bottom}, 'zoom');
    call(onZoomComplete, [{chart}]);
  } else if (state.dragMode === DRAG_MODE.RANGE) {
    call(onRangeSelected, [chart, rect.rangeDataIndex]);
  }
  state.dragMode = null;
  setTimeout(() => (state.dragging = false), 500);
}

function wheelPreconditions(chart, event, zoomOptions) {
  // Before preventDefault, check if the modifier key required and pressed
  if (keyNotPressed(getModifierKey(zoomOptions.wheel), event)) {
    call(zoomOptions.onZoomRejected, [{chart, event}]);
    return;
  }

  if (zoomStart(chart, event, zoomOptions) === false) {
    return;
  }

  // Prevent the event from triggering the default behavior (e.g. content scrolling).
  if (event.cancelable) {
    event.preventDefault();
  }

  // Firefox always fires the wheel event twice:
  // First without the delta and right after that once with the delta properties.
  if (event.deltaY === undefined) {
    return;
  }
  return true;
}

export function wheel(chart, event) {
  const {
    handlers: {onZoomComplete},
    options: {zoom: zoomOptions}
  } = getState(chart);

  if (!wheelPreconditions(chart, event, zoomOptions)) {
    return;
  }

  const rect = event.target.getBoundingClientRect();
  const speed = 1 + (event.deltaY >= 0 ? -zoomOptions.wheel.speed : zoomOptions.wheel.speed);
  const amount = {
    x: speed,
    y: speed,
    focalPoint: {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top
    }
  };

  zoom(chart, amount);

  if (onZoomComplete) {
    onZoomComplete();
  }
}

function addDebouncedHandler(chart, name, handler, delay) {
  if (handler) {
    getState(chart).handlers[name] = debounce(() => call(handler, [{chart}]), delay);
  }
}

export function addListeners(chart, options) {
  const canvas = chart.canvas;
  const {wheel: wheelOptions, drag: dragOptions, onZoomComplete} = options.zoom;

  // Install listeners. Do this dynamically based on options so that we can turn zoom on and off
  // We also want to make sure listeners aren't always on. E.g. if you're scrolling down a page
  // and the mouse goes over a chart you don't want it intercepted unless the plugin is enabled
  if (wheelOptions.enabled) {
    addHandler(chart, canvas, 'wheel', wheel);
    addDebouncedHandler(chart, 'onZoomComplete', onZoomComplete, 250);
  } else {
    removeHandler(chart, 'wheel');
  }
  if (dragOptions.enabled) {
    addHandler(chart, canvas, 'mousedown', mouseDown);
    addHandler(chart, canvas.ownerDocument, 'mouseup', mouseUp);
  } else {
    removeHandler(chart, 'mousedown');
    removeHandler(chart, 'mousemove');
    removeHandler(chart, 'mouseup');
    removeHandler(chart, 'keydown');
  }
}

export function removeListeners(chart) {
  removeHandler(chart, 'mousedown');
  removeHandler(chart, 'mousemove');
  removeHandler(chart, 'mouseup');
  removeHandler(chart, 'wheel');
  removeHandler(chart, 'click');
  removeHandler(chart, 'keydown');
}
