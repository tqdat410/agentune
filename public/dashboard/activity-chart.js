const LINE_CHART_WIDTH = 320;
const LINE_CHART_HEIGHT = 148;
const LINE_CHART_PADDING_X = 12;
const LINE_CHART_PADDING_Y = 16;
const MIN_TOOLTIP_TOP_PERCENT = 16;
const MIN_TOOLTIP_LEFT_PERCENT = 8;
const MAX_TOOLTIP_LEFT_PERCENT = 92;

let cleanupActivityChart = () => {};

export function renderActivityChart(container, activity7d) {
  cleanupActivityChart();
  cleanupActivityChart = () => {};

  container.replaceChildren();
  container.setAttribute('role', 'group');
  container.setAttribute('aria-label', 'Listening activity for the last 7 days');

  const maxPlays = Math.max(...activity7d.map((bucket) => bucket.plays), 0);
  if (maxPlays === 0) {
    container.append(createEmptyState('div', 'No plays yet.'));
    return;
  }

  const supportsHover = window.matchMedia('(hover: hover)').matches;
  const chartShell = document.createElement('div');
  const stage = document.createElement('div');
  const tooltip = document.createElement('div');
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
  const gradient = document.createElementNS('http://www.w3.org/2000/svg', 'linearGradient');
  const stopTop = document.createElementNS('http://www.w3.org/2000/svg', 'stop');
  const stopBottom = document.createElementNS('http://www.w3.org/2000/svg', 'stop');
  const areaPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  const linePath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  const labels = document.createElement('div');
  const points = buildPoints(activity7d, maxPlays);
  const pointNodes = [];
  const targetNodes = [];
  let pinnedIndex = null;

  chartShell.className = 'activity-line-shell';
  stage.className = 'activity-line-stage';
  tooltip.className = 'activity-line-tooltip';
  tooltip.setAttribute('aria-hidden', 'true');
  labels.className = 'activity-line-labels';

  svg.setAttribute('viewBox', `0 0 ${LINE_CHART_WIDTH} ${LINE_CHART_HEIGHT}`);
  svg.setAttribute('class', 'activity-line-svg');
  svg.setAttribute('preserveAspectRatio', 'none');
  svg.setAttribute('aria-hidden', 'true');

  gradient.setAttribute('id', 'activity-line-gradient');
  gradient.setAttribute('x1', '0');
  gradient.setAttribute('x2', '0');
  gradient.setAttribute('y1', '0');
  gradient.setAttribute('y2', '1');

  stopTop.setAttribute('offset', '0%');
  stopTop.setAttribute('stop-color', '#ffffff');
  stopTop.setAttribute('stop-opacity', '0.24');
  stopBottom.setAttribute('offset', '100%');
  stopBottom.setAttribute('stop-color', '#ffffff');
  stopBottom.setAttribute('stop-opacity', '0');
  gradient.append(stopTop, stopBottom);
  defs.append(gradient);

  areaPath.setAttribute('d', buildAreaPath(points));
  areaPath.setAttribute('class', 'activity-line-area');
  areaPath.setAttribute('fill', 'url(#activity-line-gradient)');

  linePath.setAttribute('d', buildSmoothPath(points));
  linePath.setAttribute('class', 'activity-line-stroke');

  svg.append(defs, areaPath, linePath);
  points.forEach((point, index) => {
    const circle = createPoint(point, index === points.length - 1);
    const target = createTarget(activity7d[index], point);

    circle.classList.add('activity-line-point');
    if (index === points.length - 1) {
      circle.classList.add('is-last');
    }

    target.addEventListener('pointerenter', () => {
      if (supportsHover && pinnedIndex === null) {
        showTooltip(index);
      }
    });

    target.addEventListener('pointerleave', () => {
      if (supportsHover) {
        hideTooltip();
      }
    });

    target.addEventListener('focus', () => {
      showTooltip(index);
    });

    target.addEventListener('blur', () => {
      hideTooltip();
    });

    target.addEventListener('click', () => {
      if (!supportsHover) {
        showTooltip(index, { pin: true });
      }
    });

    target.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        hideTooltip({ clearPinned: true });
        target.blur();
      }
    });

    pointNodes.push(circle);
    targetNodes.push(target);
    svg.append(circle);
    stage.append(target);
  });

  activity7d.forEach((bucket) => {
    const label = document.createElement('span');
    label.className = 'activity-line-label';
    label.textContent = bucket.dayLabel;
    labels.append(label);
  });

  stage.prepend(svg);
  stage.append(tooltip);
  chartShell.append(stage, labels);
  container.append(chartShell);

  const handleDocumentPointerDown = (event) => {
    if (!(event.target instanceof Node)) {
      return;
    }
    if (!stage.contains(event.target)) {
      hideTooltip({ clearPinned: true });
    }
  };

  document.addEventListener('pointerdown', handleDocumentPointerDown);
  cleanupActivityChart = () => {
    document.removeEventListener('pointerdown', handleDocumentPointerDown);
  };

  function showTooltip(index, { pin = false } = {}) {
    const point = points[index];
    const bucket = activity7d[index];

    if (pin) {
      pinnedIndex = index;
    }

    tooltip.textContent = String(bucket.plays);
    tooltip.classList.add('is-visible');
    tooltip.style.setProperty('--tooltip-left', `${clamp((point.x / LINE_CHART_WIDTH) * 100, MIN_TOOLTIP_LEFT_PERCENT, MAX_TOOLTIP_LEFT_PERCENT)}%`);
    tooltip.style.setProperty('--tooltip-top', `${Math.max((point.y / LINE_CHART_HEIGHT) * 100, MIN_TOOLTIP_TOP_PERCENT)}%`);

    pointNodes.forEach((node, nodeIndex) => {
      node.classList.toggle('is-active', nodeIndex === index);
    });
    targetNodes.forEach((node, nodeIndex) => {
      node.classList.toggle('is-active', nodeIndex === index);
    });
  }

  function hideTooltip({ clearPinned = false } = {}) {
    if (clearPinned) {
      pinnedIndex = null;
    }

    if (pinnedIndex !== null) {
      showTooltip(pinnedIndex);
      return;
    }

    tooltip.classList.remove('is-visible');
    pointNodes.forEach((node) => node.classList.remove('is-active'));
    targetNodes.forEach((node) => node.classList.remove('is-active'));
  }
}

function createPoint(point, isLast) {
  const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
  circle.setAttribute('cx', String(point.x));
  circle.setAttribute('cy', String(point.y));
  circle.setAttribute('r', isLast ? '4' : '3');
  return circle;
}

function createTarget(bucket, point) {
  const target = document.createElement('button');
  target.type = 'button';
  target.className = 'activity-line-target';
  target.setAttribute('aria-label', `${bucket.dayLabel}: ${bucket.plays}`);
  target.style.left = `${(point.x / LINE_CHART_WIDTH) * 100}%`;
  target.style.top = `${(point.y / LINE_CHART_HEIGHT) * 100}%`;
  return target;
}

function buildPoints(activity7d, maxPlays) {
  const innerWidth = LINE_CHART_WIDTH - (LINE_CHART_PADDING_X * 2);
  const innerHeight = LINE_CHART_HEIGHT - (LINE_CHART_PADDING_Y * 2);
  const stepX = activity7d.length > 1 ? innerWidth / (activity7d.length - 1) : innerWidth;

  return activity7d.map((bucket, index) => ({
    x: LINE_CHART_PADDING_X + (stepX * index),
    y: LINE_CHART_PADDING_Y + innerHeight - ((bucket.plays / maxPlays) * innerHeight),
  }));
}

function buildSmoothPath(points) {
  if (points.length === 0) {
    return '';
  }
  if (points.length === 1) {
    return `M ${points[0].x} ${points[0].y}`;
  }

  let d = `M ${points[0].x} ${points[0].y}`;
  for (let index = 0; index < points.length - 1; index += 1) {
    const current = points[index];
    const next = points[index + 1];
    const midX = (current.x + next.x) / 2;
    d += ` C ${midX} ${current.y}, ${midX} ${next.y}, ${next.x} ${next.y}`;
  }
  return d;
}

function buildAreaPath(points) {
  if (points.length === 0) {
    return '';
  }

  const baseline = LINE_CHART_HEIGHT - LINE_CHART_PADDING_Y;
  return `${buildSmoothPath(points)} L ${points[points.length - 1].x} ${baseline} L ${points[0].x} ${baseline} Z`;
}

function createEmptyState(tagName, message) {
  const item = document.createElement(tagName);
  item.className = 'insight-empty';
  item.textContent = message;
  return item;
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}
