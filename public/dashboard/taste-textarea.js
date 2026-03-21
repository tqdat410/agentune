export function syncTasteTextareaHeight(textarea) {
  textarea.style.height = '0px';
  textarea.style.height = `${textarea.scrollHeight}px`;
}
