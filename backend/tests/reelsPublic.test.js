'use strict';

const request = require('supertest');
const fs = require('fs');
const path = require('path');
const { startServer } = require('./helpers/testServer');
const { makeTempDataDir } = require('./helpers/testData');
const { registerCleanup } = require('./helpers/cleanup');

const BASE = '/api/v1/platform-public/reels';

let app;
let dataDir;
let reelsSvc;

registerCleanup(() => [], () => {
  if (dataDir && fs.existsSync(dataDir)) {
    try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch (_) {}
  }
});

beforeAll(async () => {
  dataDir = makeTempDataDir('reels-public');
  process.env.DIGITRONICS_DATA_DIR = dataDir;
  jest.resetModules();
  ({ app } = await startServer(dataDir));
  reelsSvc = require('../services/reels.service.js');
});

afterAll(() => {
  delete process.env.DIGITRONICS_DATA_DIR;
  jest.resetModules();
});

function clearReels() {
  if (reelsSvc && dataDir) {
    try {
      const fileStore = require('../utils/fileStore.js');
      fileStore.write('reels', { reels: [] });
    } catch (_) {}
  }
}

describe('GET /api/v1/platform-public/reels', () => {
  beforeEach(() => clearReels());

  test('public feed returns 200 with reels and count', async () => {
    reelsSvc.upsert({
      id: 'r1',
      creator: 'DigiTronics',
      mediaUrl: 'https://example.test/video1.mp4',
      thumbnailUrl: 'https://example.test/thumb1.jpg',
      caption: 'First public reel',
      hashtags: ['omni', 'reels'],
      visibility: 'public',
      status: 'ready'
    }, true);

    const res = await request(app).get(BASE);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data.reels)).toBe(true);
    expect(res.body.data.count).toBe(1);
    expect(res.body.data.reels[0].id).toBe('r1');
  });

  test('returns empty feed gracefully when no public reels exist', async () => {
    const res = await request(app).get(BASE);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.reels.length).toBe(0);
    expect(res.body.data.count).toBe(0);
  });

  test('public feed excludes draft reels', async () => {
    reelsSvc.upsert({
      id: 'draft1',
      creator: 'DigiTronics',
      mediaUrl: 'https://example.test/draft1.mp4',
      visibility: 'draft',
      status: 'ready'
    }, true);

    const res = await request(app).get(BASE);
    expect(res.status).toBe(200);
    expect(res.body.data.reels.length).toBe(0);
  });

  test('public feed excludes private reels', async () => {
    reelsSvc.upsert({
      id: 'private1',
      creator: 'DigiTronics',
      mediaUrl: 'https://example.test/private1.mp4',
      visibility: 'private',
      status: 'ready'
    }, true);

    const res = await request(app).get(BASE);
    expect(res.status).toBe(200);
    expect(res.body.data.reels.length).toBe(0);
  });

  test('public feed excludes non-ready reels', async () => {
    reelsSvc.upsert({
      id: 'proc1',
      creator: 'DigiTronics',
      mediaUrl: 'https://example.test/proc1.mp4',
      visibility: 'public',
      status: 'processing'
    }, true);

    const res = await request(app).get(BASE);
    expect(res.status).toBe(200);
    expect(res.body.data.reels.length).toBe(0);
  });

  test('public feed is ordered newest first', async () => {
    reelsSvc.upsert({
      id: 'old',
      creator: 'DigiTronics',
      mediaUrl: 'https://example.test/old.mp4',
      visibility: 'public',
      status: 'ready',
      createdAt: new Date('2026-01-01T00:00:00Z').toISOString()
    }, true);
    reelsSvc.upsert({
      id: 'new',
      creator: 'DigiTronics',
      mediaUrl: 'https://example.test/new.mp4',
      visibility: 'public',
      status: 'ready',
      createdAt: new Date('2026-02-01T00:00:00Z').toISOString()
    }, true);

    const res = await request(app).get(BASE);
    expect(res.status).toBe(200);
    expect(res.body.data.reels.length).toBe(2);
    expect(res.body.data.reels[0].id).toBe('new');
    expect(res.body.data.reels[1].id).toBe('old');
  });

  test('public feed response contains no draft/private metadata', async () => {
    reelsSvc.upsert({
      id: 'public1',
      creator: 'DigiTronics',
      mediaUrl: 'https://example.test/pub.mp4',
      caption: 'Public',
      visibility: 'public',
      status: 'ready'
    }, true);
    reelsSvc.upsert({
      id: 'private2',
      creator: 'DigiTronics',
      mediaUrl: 'https://example.test/priv.mp4',
      caption: 'Private',
      visibility: 'private',
      status: 'ready'
    }, true);

    const res = await request(app).get(BASE);
    expect(res.status).toBe(200);
    const raw = JSON.stringify(res.body);
    expect(raw).not.toContain('private2');
    expect(res.body.data.reels.length).toBe(1);
    expect(res.body.data.reels[0].id).toBe('public1');
  });
});

describe('GET /api/v1/platform-public/reels/:id', () => {
  beforeEach(() => clearReels());

  test('returns a public ready reel by id', async () => {
    reelsSvc.upsert({
      id: 'byid1',
      creator: 'Creator',
      mediaUrl: 'https://example.test/byid1.mp4',
      thumbnailUrl: 'https://example.test/byid1.jpg',
      caption: 'Singular public reel',
      hashtags: ['single'],
      visibility: 'public',
      status: 'ready'
    }, true);

    const res = await request(app).get(BASE + '/byid1');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.reel.id).toBe('byid1');
    expect(res.body.data.reel.mediaUrl).toBe('https://example.test/byid1.mp4');
    expect(res.body.data.reel.caption).toBe('Singular public reel');
    expect(Array.isArray(res.body.data.reel.hashtags)).toBe(true);
    expect(res.body.data.reel.hashtags).toEqual(['single']);
  });

  test('returns 404 for unknown reel id', async () => {
    const res = await request(app).get(BASE + '/does-not-exist');
    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
  });

  test('returns 404 for a draft reel by id', async () => {
    reelsSvc.upsert({
      id: 'draft-byid',
      creator: 'Creator',
      mediaUrl: 'https://example.test/draft-byid.mp4',
      visibility: 'draft',
      status: 'ready'
    }, true);

    const res = await request(app).get(BASE + '/draft-byid');
    expect(res.status).toBe(404);
  });

  test('returns 404 for a private reel by id', async () => {
    reelsSvc.upsert({
      id: 'private-byid',
      creator: 'Creator',
      mediaUrl: 'https://example.test/private-byid.mp4',
      visibility: 'private',
      status: 'ready'
    }, true);

    const res = await request(app).get(BASE + '/private-byid');
    expect(res.status).toBe(404);
  });

  test('returns 404 for a single-reel lookup with a missing id', async () => {
    const res = await request(app).get(BASE + '/does-not-exist');
    expect(res.status).toBe(404);
  });

  test('returns 404 for a single-reel lookup with an empty id segment', async () => {
    const res = await request(app).get(BASE + '/%20');
    expect([400, 404]).toContain(res.status);
  });

  test('trailing slash on /reels returns the public feed, not a single-reel lookup', async () => {
    reelsSvc.upsert({
      id: 'trailing-1',
      creator: 'DigiTronics',
      mediaUrl: 'https://example.test/trailing.mp4',
      visibility: 'public',
      status: 'ready'
    }, true);

    const feedRes = await request(app).get(BASE + '/');
    expect(feedRes.status).toBe(200);
    expect(feedRes.body.success).toBe(true);
    expect(feedRes.body.data.reels.length).toBe(1);
    expect(feedRes.body.data.reels[0].id).toBe('trailing-1');
  });
});

describe('Public reels endpoint access model', () => {
  beforeEach(() => clearReels());

  test('public feed requires no auth and still excludes non-public content', async () => {
    reelsSvc.upsert({
      id: 'auth1',
      creator: 'Creator',
      mediaUrl: 'https://example.test/auth1.mp4',
      visibility: 'private',
      status: 'ready'
    }, true);

    const res = await request(app).get(BASE);
    expect(res.status).toBe(200);
    expect(res.body.data.reels.length).toBe(0);
  });
});
