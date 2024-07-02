import Hammer from 'hammerjs';
import {addListeners, computeDragRect, removeListeners} from './handlers';
import {startHammer, stopHammer} from './hammer';
import {pan, zoom, resetZoom, zoomScale, getZoomLevel, getInitialScaleBounds, isZoomedOrPanned, zoomRect} from './core';
import {panFunctions, zoomFunctions, zoomRectFunctions} from './scale.types';
import {getState, removeState, DRAG_MODE} from './state';
import {version} from '../package.json';
import {directionEnabled} from './utils';

function doDrawDrag(chart, caller, options) {
  const dragOptions = options.zoom.drag;
  const {dragStart, dragEnd} = getState(chart);

  if (dragOptions.drawTime !== caller || !dragEnd) {
    return;
  }
  const {left, top, width, height} = computeDragRect(chart, options.zoom.mode, DRAG_MODE.DRAG, false, dragStart, dragEnd);
  const ctx = chart.ctx;

  ctx.save();
  ctx.beginPath();
  ctx.fillStyle = dragOptions.backgroundColor || 'rgba(225,225,225,0.3)';
  ctx.fillRect(left, top, width, height);

  if (dragOptions.borderWidth > 0) {
    ctx.lineWidth = dragOptions.borderWidth;
    ctx.strokeStyle = dragOptions.borderColor || 'rgba(225,225,225)';
    ctx.strokeRect(left, top, width, height);
  }
  ctx.restore();
}

function doDrawRange(chart, caller, options) {
  const {dragStart, dragEnd} = getState(chart);
  const {drawTime, mode: rangeMode, mirroring, backgroundColor, borderWidth, borderColor, label} = options.range;

  if (drawTime !== caller || !dragEnd) {
    return;
  }

  const {left, right, top, bottom, width, height, rangeDataIndex} = computeDragRect(chart, rangeMode, DRAG_MODE.RANGE, mirroring, dragStart, dragEnd);
  const ctx = chart.ctx;
  const {left: xLeftIndex, right: xRightIndex} = rangeDataIndex.x;
  const {top: yTopIndex, bottom: yBottomIndex} = rangeDataIndex.y;

  ctx.save();
  ctx.fillStyle = backgroundColor || 'rgba(225,0,0,0.3)';
  ctx.fillRect(left, top, width, height);

  if (borderWidth > 0) {
    ctx.lineWidth = borderWidth;
    ctx.strokeStyle = borderColor || 'rgba(225,0,0)';
    ctx.strokeRect(left, top, width, height);
  }

  // draw text for range
  const {xFormatter, yFormatter, font, enabled} = label;

  if (enabled) {
    // Note: the order is important. Please refer to below for details.
    // https://developer.mozilla.org/en-US/docs/Web/CSS/font
    ctx.font = `${font.weight} ${font.size}px "Helvetica Neue", Helvetica, Arial, sans-serif`;
    ctx.fillStyle = font.color;

    const xEnabled = directionEnabled(rangeMode, 'x', chart);
    const yEnabled = directionEnabled(rangeMode, 'y', chart);

    if (xEnabled) {
      // put labels on both left and right side of rectangle
      const textTop = top + (bottom - top) / 2;
      const textLRMargin = font.size;
      const lhsText = `${xFormatter ? xFormatter(Math.floor(xLeftIndex)) : Math.floor(xLeftIndex)}`;
      const rhsText = `${xFormatter ? xFormatter(Math.ceil(xRightIndex)) : Math.ceil(xRightIndex)}`;
      const lhsMeasure = ctx.measureText(lhsText);

      ctx.fillText(lhsText, left - lhsMeasure.width - textLRMargin, textTop);
      ctx.fillText(rhsText, left + width + textLRMargin, textTop);
    }

    if (yEnabled) {
      // put labels on both top and bottom side of rectangle
      const topText = `${yFormatter ? yFormatter(Math.floor(yTopIndex)) : Math.floor(yTopIndex)}`;
      const bottomText = `${yFormatter ? yFormatter(Math.ceil(yBottomIndex)) : Math.ceil(yBottomIndex)}`;

      const textMeasure = ctx.measureText(topText);

      const textTop = top - font.size;
      const textBottom = bottom + font.size;

      ctx.fillText(topText, left + (right - left) / 2 - textMeasure.width / 2, textTop);
      ctx.fillText(bottomText, left + (right - left) / 2 - textMeasure.width / 2, textBottom);
    }
  }

  ctx.restore();
}

function draw(chart, caller, options) {
  const {dragMode} = getState(chart);
  if (dragMode === DRAG_MODE.DRAG) {
    doDrawDrag(chart, caller, options);
  } else if (dragMode === DRAG_MODE.RANGE) {
    doDrawRange(chart, caller, options);
  }
}

export default {
  id: 'zoom',

  version,

  defaults: {
    pan: {
      enabled: false,
      mode: 'xy',
      threshold: 10,
      modifierKey: null
    },
    zoom: {
      wheel: {
        enabled: false,
        speed: 0.1,
        modifierKey: null
      },
      drag: {
        enabled: false,
        drawTime: 'beforeDatasetsDraw',
        modifierKey: null
      },
      pinch: {
        enabled: false
      },
      mode: 'xy'
    },
    range: {
      enabled: false,
      mode: 'x',
      mirroring: true,
      drawTime: 'beforeDatasetsDraw',
      modifierKey: 'alt',
      backgroundColor: 'rgba(255, 99, 132, 0.2)',
      borderColor: 'rgb(255, 99, 132)',
      borderWidth: 1,
      label: {
        font: {
          size: 13,
          weight: 'normal',
          color: 'rgb(255, 99, 132)'
        },
        marginTop: 36,
        formatter: null
      },
      onRangeSelected: (chart, rect) => {}
    }
  },

  start: function (chart, _args, options) {
    const state = getState(chart);
    state.options = options;

    if (Object.prototype.hasOwnProperty.call(options.zoom, 'enabled')) {
      console.warn(
        'The option `zoom.enabled` is no longer supported. Please use `zoom.wheel.enabled`, `zoom.drag.enabled`, or `zoom.pinch.enabled`.'
      );
    }
    if (Object.prototype.hasOwnProperty.call(options.zoom, 'overScaleMode') || Object.prototype.hasOwnProperty.call(options.pan, 'overScaleMode')) {
      console.warn('The option `overScaleMode` is deprecated. Please use `scaleMode` instead (and update `mode` as desired).');
    }

    if (Hammer) {
      startHammer(chart, options);
    }

    chart.pan = (delta, panScales, transition) => pan(chart, delta, panScales, transition);
    chart.zoom = (args, transition) => zoom(chart, args, transition);
    chart.zoomRect = (p0, p1, transition) => zoomRect(chart, p0, p1, transition);
    chart.zoomScale = (id, range, transition) => zoomScale(chart, id, range, transition);
    chart.resetZoom = (transition) => resetZoom(chart, transition);
    chart.getZoomLevel = () => getZoomLevel(chart);
    chart.getInitialScaleBounds = () => getInitialScaleBounds(chart);
    chart.isZoomedOrPanned = () => isZoomedOrPanned(chart);
  },

  beforeEvent(chart) {
    const state = getState(chart);
    if (state.panning || state.dragging) {
      // cancel any event handling while panning or dragging
      return false;
    }
  },

  beforeUpdate: function (chart, args, options) {
    const state = getState(chart);
    state.options = options;
    addListeners(chart, options);
  },

  beforeDatasetsDraw(chart, _args, options) {
    draw(chart, 'beforeDatasetsDraw', options);
  },

  afterDatasetsDraw(chart, _args, options) {
    draw(chart, 'afterDatasetsDraw', options);
  },

  beforeDraw(chart, _args, options) {
    draw(chart, 'beforeDraw', options);
  },

  afterDraw(chart, _args, options) {
    draw(chart, 'afterDraw', options);
  },

  stop: function (chart) {
    removeListeners(chart);

    if (Hammer) {
      stopHammer(chart);
    }
    removeState(chart);
  },

  panFunctions,
  zoomFunctions,
  zoomRectFunctions
};
