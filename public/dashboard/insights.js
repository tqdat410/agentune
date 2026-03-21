import { elements } from './dom.js';
import { renderActivityChart as renderDashboardActivityChart } from './activity-chart.js';

export function renderInsights(stats) {
  elements.insightPlays.textContent = String(stats.insights.plays7d);
  elements.insightTracks.textContent = String(stats.insights.tracks7d);

  renderDashboardActivityChart(elements.activityChart, stats.insights.activity7d);
  renderTopArtists(stats.insights.topArtists.slice(0, 3));
  renderTopKeywords(stats.insights.topKeywords);
}

function renderTopArtists(topArtists) {
  elements.topArtists.replaceChildren();

  if (topArtists.length === 0) {
    elements.topArtists.append(createEmptyState('li', 'No artists.'));
    return;
  }

  topArtists.forEach((artist, index) => {
    const item = document.createElement('li');
    const indexValue = document.createElement('span');
    const copy = document.createElement('div');
    const title = document.createElement('strong');
    const meta = document.createElement('span');

    item.className = 'rank-item rank-item-minimal';
    indexValue.className = 'rank-index';
    copy.className = 'rank-copy';
    title.className = 'rank-title';
    meta.className = 'rank-meta';

    indexValue.textContent = String(index + 1).padStart(2, '0');
    title.textContent = artist.artist;
    meta.textContent = String(artist.plays);

    copy.append(title, meta);
    item.append(indexValue, copy);
    elements.topArtists.append(item);
  });
}

function renderTopKeywords(topKeywords) {
  elements.topKeywords.replaceChildren();

  if (topKeywords.length === 0) {
    elements.topKeywords.append(createEmptyState('li', 'No tags.'));
    return;
  }

  topKeywords.forEach((keyword) => {
    const item = document.createElement('li');
    const label = document.createElement('span');

    item.className = 'keyword-chip keyword-chip-minimal';
    label.className = 'keyword-label';

    label.textContent = keyword.keyword;

    item.append(label);
    elements.topKeywords.append(item);
  });
}

function createEmptyState(tagName, message) {
  const item = document.createElement(tagName);
  item.className = 'insight-empty';
  item.textContent = message;
  return item;
}
