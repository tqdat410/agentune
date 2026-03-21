export function toggleHiddenAttribute(element, hidden) {
  if (typeof element?.toggleAttribute !== 'function') {
    return;
  }

  element.toggleAttribute('hidden', hidden);
}
