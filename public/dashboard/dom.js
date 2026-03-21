function getElement(selector) {
  const element = document.querySelector(selector);
  if (!element) {
    throw new Error(`Missing element for selector: ${selector}`);
  }
  return element;
}

export const elements = {
  activityChart: getElement('[data-activity-chart]'),
  artist: getElement('[data-artist]'),
  art: getElement('[data-art]'),
  databaseActions: Array.from(document.querySelectorAll('[data-db-action]')),
  databaseMessage: getElement('[data-db-message]'),
  databasePath: getElement('[data-db-path]'),
  databasePlays: getElement('[data-db-plays]'),
  databaseProviderCache: getElement('[data-db-cache]'),
  databaseTracks: getElement('[data-db-tracks]'),
  durationFill: getElement('[data-duration-fill]'),
  elapsed: getElement('[data-elapsed]'),
  insightPlays: getElement('[data-insight-plays]'),
  insightTracks: getElement('[data-insight-tracks]'),
  navButtons: Array.from(document.querySelectorAll('[data-nav]')),
  next: getElement('[data-next]'),
  pause: getElement('[data-pause]'),
  personaMessage: getElement('[data-message]'),
  queue: getElement('[data-queue]'),
  queueArt: getElement('[data-queue-art]'),
  queueCurrentArtist: getElement('[data-queue-current-artist]'),
  queueCurrentTitle: getElement('[data-queue-current-title]'),
  saveTaste: getElement('[data-save-taste]'),
  sharedControls: getElement('[data-shared-controls]'),
  stopDaemon: getElement('[data-stop-daemon]'),
  taste: getElement('[data-taste]'),
  title: getElement('[data-title]'),
  topArtists: getElement('[data-top-artists]'),
  topKeywords: getElement('[data-top-keywords]'),
  totalDuration: getElement('[data-total-duration]'),
  viewPanels: Array.from(document.querySelectorAll('[data-view]')),
  volume: getElement('[data-volume]'),
};
