function createStructure(titleElement) {
  const initialText = titleElement.textContent ?? '';
  titleElement.textContent = '';

  const viewport = document.createElement('span');
  viewport.className = 'track-title-viewport';

  const track = document.createElement('span');
  track.className = 'track-title-track';

  const primary = document.createElement('span');
  primary.className = 'track-title-copy primary';

  const secondary = document.createElement('span');
  secondary.className = 'track-title-copy secondary';
  secondary.setAttribute('aria-hidden', 'true');
  secondary.hidden = true;

  track.append(primary, secondary);
  viewport.append(track);
  titleElement.append(viewport);

  primary.textContent = initialText;

  return { primary, secondary, track, viewport };
}

export function createTitleMarquee(elements) {
  let animationFrame = 0;
  const { primary, secondary, track, viewport } = createStructure(elements.title);
  const resizeObserver = new ResizeObserver(() => queueMeasure());

  resizeObserver.observe(elements.title);
  resizeObserver.observe(viewport);
  window.addEventListener('resize', queueMeasure);

  function reset() {
    elements.title.classList.remove('is-long');
    secondary.hidden = true;
    secondary.textContent = '';
    track.style.removeProperty('--title-gap');
    track.style.removeProperty('--title-distance');
    track.style.removeProperty('--title-duration');
  }

  function queueMeasure() {
    window.cancelAnimationFrame(animationFrame);
    animationFrame = window.requestAnimationFrame(measure);
  }

  function measure() {
    const text = primary.textContent ?? '';
    const viewportWidth = viewport.clientWidth;
    const textWidth = primary.scrollWidth;

    if (!text || textWidth <= viewportWidth + 6) {
      reset();
      return;
    }

    const gap = Math.max(32, Math.round(viewportWidth * 0.16));
    const distance = textWidth + gap;
    const duration = Math.max(distance / 18, 14);

    secondary.hidden = false;
    secondary.textContent = text;
    track.style.setProperty('--title-gap', `${gap}px`);
    track.style.setProperty('--title-distance', `${distance}px`);
    track.style.setProperty('--title-duration', `${duration}s`);
    elements.title.classList.add('is-long');
  }

  return {
    destroy() {
      resizeObserver.disconnect();
      window.removeEventListener('resize', queueMeasure);
      window.cancelAnimationFrame(animationFrame);
    },
    refresh: queueMeasure,
    setText(text) {
      primary.textContent = text;
      elements.title.dataset.title = text;
      queueMeasure();
    },
  };
}
