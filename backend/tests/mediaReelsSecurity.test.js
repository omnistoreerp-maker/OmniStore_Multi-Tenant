'use strict';

const fs = require('fs');
const path = require('path');

const BUSINESS_HTML = path.join(__dirname, '..', '..', 'business.html');
const TIKTOK_SERVICE = require('../services/tiktokFeed.service');

describe('Media/Reels security and gating', () => {
  test('tiktokFeed service does not export a production TikTok username placeholder', () => {
    expect(TIKTOK_SERVICE.TIKTOK_USERNAME).not.toBe('YOUR_TIKTOK_USERNAME_HERE');
  });

  test('tiktokFeed service fallback embed does not expose placeholder username', async () => {
    const result = await TIKTOK_SERVICE.fetchTikTokFeed();
    expect(result && result.data && Array.isArray(result.data)).toBe(true);
    for (const item of result.data) {
      expect(item.author_name).not.toBe('YOUR_TIKTOK_USERNAME_HERE');
      expect(item.url).not.toContain('YOUR_TIKTOK_USERNAME_HERE');
    }
  });

  test('business.html does not contain TikTok placeholder', () => {
    const html = fs.readFileSync(BUSINESS_HTML, 'utf-8');
    expect(html).not.toContain('YOUR_TIKTOK_USERNAME_HERE');
    expect(html).not.toContain('tiktok-feed');
    expect(html).not.toContain('embed.js');
    expect(html).not.toContain('social-feed/tiktok');
  });

  test('business.html does not inject raw external embed HTML', () => {
    const html = fs.readFileSync(BUSINESS_HTML, 'utf-8');
    expect(html).not.toMatch(/item\.embed_html/);
    expect(html).not.toMatch(/innerHTML\s*=\s*.*embed_html/);
  });

  test('platform catalog keeps media-reels as coming-soon with no active URL', () => {
    const platformCatalog = require('../services/platformCatalog.service');
    const catalog = platformCatalog.getCatalog();
    const media = catalog.sections.find(function (s) { return s.id === 'media-reels'; });
    expect(media).toBeDefined();
    expect(media.status).toBe('coming-soon');
    expect(media.url).toBeNull();
  });
});
