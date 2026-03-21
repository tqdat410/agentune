export const DATABASE_ACTION_LABELS = {
  'clear-history': 'Clear history',
  'clear-provider-cache': 'Clear provider cache',
  'full-reset': 'Full reset',
};

export const DEFAULT_THEME = {
  'ambient-start': 'rgba(18, 28, 44, 0.96)',
  'ambient-mid': 'rgba(26, 44, 70, 0.72)',
  'ambient-end': 'rgba(5, 8, 14, 0.98)',
  surface: 'rgba(10, 16, 27, 0.72)',
  'surface-strong': 'rgba(14, 20, 34, 0.92)',
  'surface-soft': 'rgba(255, 255, 255, 0.06)',
  accent: '#dce9ff',
  'accent-soft': 'rgba(173, 198, 255, 0.18)',
  'shadow-tint': 'rgba(3, 6, 12, 0.46)',
  'success-pill-bg': 'rgba(222, 233, 255, 0.16)',
  'success-pill-ink': '#f4f7ff',
};

export const STOP_DAEMON_LABEL = 'Stop daemon';

export const PLACEHOLDER_ARTWORK = `data:image/svg+xml,${encodeURIComponent(`
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 640">
    <defs>
      <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="#18263b" />
        <stop offset="100%" stop-color="#090d14" />
      </linearGradient>
    </defs>
    <rect width="640" height="640" rx="72" fill="url(#bg)" />
    <circle cx="214" cy="214" r="116" fill="rgba(214,232,255,0.12)" />
    <circle cx="408" cy="402" r="142" fill="rgba(107,160,255,0.16)" />
    <text x="64" y="532" fill="#f4f7ff" font-family="Segoe UI, sans-serif" font-size="92" font-weight="700">sbotify</text>
  </svg>
`)}`;
