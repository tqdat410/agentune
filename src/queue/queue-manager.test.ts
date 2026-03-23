import assert from 'node:assert/strict';
import test from 'node:test';
import { QueueManager } from './queue-manager.js';

test('QueueManager adds and returns queued items in order', () => {
  const queueManager = new QueueManager();
  const firstPosition = queueManager.add({
    id: '1',
    title: 'First',
    artist: 'Artist 1',
    duration: 100,
    thumbnail: 'thumb-1',
    url: 'https://example.com/1',
  });
  const secondPosition = queueManager.add({
    id: '2',
    title: 'Second',
    artist: 'Artist 2',
    duration: 120,
    thumbnail: 'thumb-2',
    url: 'https://example.com/2',
  });

  assert.equal(firstPosition, 1);
  assert.equal(secondPosition, 2);
  assert.deepEqual(queueManager.list().map((item) => item.id), ['1', '2']);
  assert.equal(queueManager.next()?.id, '1');
  assert.equal(queueManager.next()?.id, '2');
  assert.equal(queueManager.next(), null);
});

test('QueueManager archives finished tracks into history', () => {
  const queueManager = new QueueManager();
  queueManager.setNowPlaying({
    id: '1',
    title: 'Current',
    artist: 'Artist',
    duration: 100,
    thumbnail: 'thumb',
    url: 'https://example.com/1',
  });

  const finished = queueManager.finishCurrentTrack();
  const state = queueManager.getState();

  assert.equal(finished?.id, '1');
  assert.equal(state.nowPlaying, null);
  assert.deepEqual(state.history.map((item) => item.id), ['1']);
});

test('QueueManager emits queue-content-changed only for queue mutations', () => {
  const queueManager = new QueueManager();
  const events: string[][] = [];

  queueManager.on('queue-content-changed', (queue: Array<{ id: string }>) => {
    events.push(queue.map((item) => item.id));
  });

  queueManager.add({
    id: '1',
    title: 'First',
    artist: 'Artist 1',
    duration: 100,
    thumbnail: 'thumb-1',
    url: 'https://example.com/1',
  });
  queueManager.setNowPlaying({
    id: 'now',
    title: 'Now',
    artist: 'Artist Now',
    duration: 120,
    thumbnail: 'thumb-now',
    url: 'https://example.com/now',
  });
  queueManager.next();
  queueManager.finishCurrentTrack();
  queueManager.clear();

  assert.deepEqual(events, [['1'], [], []]);
});

test('QueueManager removeById removes only the matching queued item', () => {
  const queueManager = new QueueManager();
  queueManager.add({
    id: '1',
    title: 'First',
    artist: 'Artist 1',
    duration: 100,
    thumbnail: 'thumb-1',
    url: 'https://example.com/1',
  });
  queueManager.add({
    id: '2',
    title: 'Second',
    artist: 'Artist 2',
    duration: 120,
    thumbnail: 'thumb-2',
    url: 'https://example.com/2',
  });
  queueManager.add({
    id: '3',
    title: 'Third',
    artist: 'Artist 3',
    duration: 140,
    thumbnail: 'thumb-3',
    url: 'https://example.com/3',
  });

  const removed = queueManager.removeById('2');

  assert.equal(removed?.id, '2');
  assert.deepEqual(queueManager.list().map((item) => item.id), ['1', '3']);
  assert.equal(queueManager.removeById('missing'), null);
});
