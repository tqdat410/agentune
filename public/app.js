const elements = {
  artist: document.querySelector('[data-artist]'),
  art: document.querySelector('[data-art]'),
  currentTime: document.querySelector('[data-current-time]'),
  duration: document.querySelector('[data-duration]'),
  mute: document.querySelector('[data-mute]'),
  progress: document.querySelector('[data-progress]'),
  queue: document.querySelector('[data-queue]'),
  state: document.querySelector('[data-state]'),
  title: document.querySelector('[data-title]'),
  volume: document.querySelector('[data-volume]'),
  taste: document.querySelector('[data-taste]'),
  saveTaste: document.querySelector('[data-save-taste]'),
  personaMessage: document.querySelector('[data-persona-message]'),
  databasePath: document.querySelector('[data-db-path]'),
  databasePlays: document.querySelector('[data-db-plays]'),
  databaseTracks: document.querySelector('[data-db-tracks]'),
  databaseProviderCache: document.querySelector('[data-db-provider-cache]'),
  databaseMessage: document.querySelector('[data-database-message]'),
  databaseActions: Array.from(document.querySelectorAll('[data-db-action]')),
};

let socket;
let armedDatabaseAction = null;
let databaseArmTimer = null;

const DATABASE_ACTION_LABELS = {
  'clear-history': 'Clear history',
  'clear-provider-cache': 'Clear provider cache',
  'full-reset': 'Full reset',
};

function formatTime(totalSeconds) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = Math.floor(totalSeconds % 60);
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function renderQueue(queue) {
  if (queue.length === 0) {
    elements.queue.innerHTML = '<li class="queue-empty">Queue not wired yet</li>';
    return;
  }

  elements.queue.innerHTML = queue
    .map((item) => `<li><strong>${item.title}</strong><span>${item.artist}</span></li>`)
    .join('');
}

function renderState(state) {
  elements.title.textContent = state.title ?? 'Nothing playing';
  elements.artist.textContent = state.artist ?? 'Ask your agent to start a track';
  elements.state.textContent = state.playing ? 'Playing' : 'Idle';
  elements.currentTime.textContent = formatTime(state.position);
  elements.duration.textContent = formatTime(state.duration);
  elements.progress.style.width = `${state.duration > 0 ? (state.position / state.duration) * 100 : 0}%`;
  elements.volume.value = String(state.volume);
  elements.mute.textContent = state.muted ? 'Unmute' : 'Mute';
  elements.art.src = state.thumbnail || 'https://placehold.co/640x640/10131a/e6ecff?text=Sbotify';
  renderQueue(state.queue);
}

function renderDatabaseStats(stats) {
  elements.databasePath.textContent = stats.dbPath;
  elements.databasePlays.textContent = String(stats.counts.plays);
  elements.databaseTracks.textContent = String(stats.counts.tracks);
  elements.databaseProviderCache.textContent = String(stats.counts.providerCache);
}

function connect() {
  socket = new WebSocket(`ws://${window.location.host}/ws`);

  socket.addEventListener('message', (event) => {
    const payload = JSON.parse(event.data);
    if (payload.type === 'state') {
      renderState(payload.data);
    }
    if (payload.type === 'persona') {
      renderPersona(payload.data);
    }
  });

  socket.addEventListener('close', () => {
    window.setTimeout(connect, 1000);
  });
}

function sendSocketMessage(payload) {
  if (!socket || socket.readyState !== WebSocket.OPEN) {
    return;
  }

  socket.send(JSON.stringify(payload));
}

elements.volume.addEventListener('input', (event) => {
  sendSocketMessage({ type: 'volume', level: Number(event.target.value) });
});

elements.mute.addEventListener('click', () => {
  sendSocketMessage({ type: 'mute' });
});

function renderPersona(data) {
  // Don't overwrite textarea if user is editing
  if (data.taste !== undefined && document.activeElement !== elements.taste) {
    elements.taste.value = data.taste;
  }
}

function showDatabaseMessage(message, isError = false) {
  elements.databaseMessage.textContent = message;
  elements.databaseMessage.classList.toggle('is-error', isError);
}

function resetDatabaseActionArming() {
  armedDatabaseAction = null;
  if (databaseArmTimer) {
    window.clearTimeout(databaseArmTimer);
    databaseArmTimer = null;
  }
  for (const button of elements.databaseActions) {
    button.classList.remove('is-armed');
    button.textContent = DATABASE_ACTION_LABELS[button.dataset.dbAction];
  }
}

function armDatabaseAction(button, action) {
  resetDatabaseActionArming();
  armedDatabaseAction = action;
  button.classList.add('is-armed');
  button.textContent = `Confirm ${DATABASE_ACTION_LABELS[action]}`;
  showDatabaseMessage('Click the same button again within 5 seconds to confirm.');
  databaseArmTimer = window.setTimeout(() => {
    resetDatabaseActionArming();
    showDatabaseMessage('Cleanup confirmation expired.');
  }, 5000);
}

async function loadDatabaseStats() {
  try {
    const response = await fetch('/api/database/stats');
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.message ?? 'Failed to load database stats.');
    }
    renderDatabaseStats(data.stats);
  } catch (err) {
    showDatabaseMessage(err.message ?? 'Failed to load database stats.', true);
  }
}

async function runDatabaseAction(action, button) {
  button.disabled = true;
  try {
    const response = await fetch(`/api/database/${action}`, { method: 'POST' });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.message ?? 'Database cleanup failed.');
    }

    renderDatabaseStats(data.stats);
    showDatabaseMessage(data.message ?? 'Cleanup complete.');
    resetDatabaseActionArming();
  } catch (err) {
    showDatabaseMessage(err.message ?? 'Database cleanup failed.', true);
  } finally {
    button.disabled = false;
    await loadDatabaseStats();
  }
}

elements.saveTaste.addEventListener('click', () => {
  fetch('/api/persona', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ taste: elements.taste.value.trim() }),
  })
    .then(async (response) => {
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.message ?? 'Persona save failed.');
      }
      return data;
    })
    .then((data) => {
      showPersonaMessage('Persona saved.');
      if (data.taste !== undefined) renderPersona(data);
    })
    .catch((err) => {
      showPersonaMessage(err.message ?? 'Persona save failed.', true);
      console.error('Save taste failed:', err);
    });
});

for (const button of elements.databaseActions) {
  button.addEventListener('click', async () => {
    const action = button.dataset.dbAction;
    if (!action) {
      return;
    }
    if (armedDatabaseAction !== action) {
      armDatabaseAction(button, action);
      return;
    }
    await runDatabaseAction(action, button);
  });
}

fetch('/api/status')
  .then((response) => response.json())
  .then((state) => renderState(state))
  .catch(() => {
    elements.state.textContent = 'Waiting for server';
  });

fetch('/api/persona')
  .then((response) => response.json())
  .then((data) => renderPersona(data))
  .catch(() => {});

void loadDatabaseStats();

connect();

function showPersonaMessage(message, isError = false) {
  elements.personaMessage.textContent = message;
  elements.personaMessage.classList.toggle('is-error', isError);
}
