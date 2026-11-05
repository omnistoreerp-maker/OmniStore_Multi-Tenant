'use strict';

// Unit tests for backend/utils/googleIdentity.js.
//
// The REAL verification logic runs. Only the external HTTP response is
// stubbed (global.fetch), so every audience/issuer/expiry/email rule is the
// code under test. No real Google request is made.

const ORIGINAL_ENV = {
  CLIENT_ID: process.env.GOOGLE_CLIENT_ID,
  TOKENINFO_URL: process.env.GOOGLE_TOKENINFO_URL
};
const ORIGINAL_FETCH = global.fetch;

const CLIENT_ID = 'test-client-id.apps.googleusercontent.com';
const TOKEN = 'fake.id.token';

const fetchMock = jest.fn();
let verifyIdToken;

function nowSeconds() {
  return Math.floor(Date.now() / 1000);
}

function goodPayload(overrides = {}) {
  return {
    sub: 'google-sub-1',
    email: 'user@example.com',
    email_verified: 'true',
    aud: CLIENT_ID,
    iss: 'https://accounts.google.com',
    exp: String(nowSeconds() + 3600),
    ...overrides
  };
}

function respond(payload, { ok = true, status = 200 } = {}) {
  return Promise.resolve({
    ok,
    status,
    json: async () => payload
  });
}

beforeAll(() => {
  process.env.GOOGLE_CLIENT_ID = CLIENT_ID;
  delete process.env.GOOGLE_TOKENINFO_URL;
  global.fetch = fetchMock;
  verifyIdToken = require('../utils/googleIdentity').verifyIdToken;
});

afterAll(() => {
  if (ORIGINAL_ENV.CLIENT_ID === undefined) delete process.env.GOOGLE_CLIENT_ID;
  else process.env.GOOGLE_CLIENT_ID = ORIGINAL_ENV.CLIENT_ID;
  if (ORIGINAL_ENV.TOKENINFO_URL === undefined) delete process.env.GOOGLE_TOKENINFO_URL;
  else process.env.GOOGLE_TOKENINFO_URL = ORIGINAL_ENV.TOKENINFO_URL;
  global.fetch = ORIGINAL_FETCH;
});

beforeEach(() => {
  fetchMock.mockReset();
  process.env.GOOGLE_CLIENT_ID = CLIENT_ID;
  delete process.env.GOOGLE_TOKENINFO_URL;
});

describe('googleIdentity.verifyIdToken', () => {
  test('accepts a valid token and returns the verified subject/email', async () => {
    fetchMock.mockReturnValue(respond(goodPayload()));

    const result = await verifyIdToken(TOKEN);

    expect(result).toEqual({ sub: 'google-sub-1', email: 'user@example.com' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test('verifies against Google tokeninfo with the token URL-encoded', async () => {
    fetchMock.mockReturnValue(respond(goodPayload()));

    await verifyIdToken(TOKEN);

    const url = fetchMock.mock.calls[0][0];
    expect(url).toBe(
      'https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(TOKEN)
    );
    const options = fetchMock.mock.calls[0][1];
    expect(options.method).toBe('GET');
    expect(options.signal).toBeDefined();
  });

  test('rejects a token issued for a different audience', async () => {
    fetchMock.mockReturnValue(respond(goodPayload({ aud: 'someone-else.apps.googleusercontent.com' })));

    const result = await verifyIdToken(TOKEN);

    expect(result.error).toMatch(/audience/i);
    expect(result.sub).toBeUndefined();
  });

  test('rejects a token from a non-Google issuer', async () => {
    fetchMock.mockReturnValue(respond(goodPayload({ iss: 'https://evil.example.com' })));

    const result = await verifyIdToken(TOKEN);

    expect(result.error).toMatch(/issuer/i);
  });

  test('rejects an expired token even when the endpoint returns 200', async () => {
    fetchMock.mockReturnValue(respond(goodPayload({ exp: String(nowSeconds() - 10) })));

    const result = await verifyIdToken(TOKEN);

    expect(result.error).toMatch(/expired/i);
  });

  test('rejects a token with no expiry', async () => {
    const payload = goodPayload();
    delete payload.exp;
    fetchMock.mockReturnValue(respond(payload));

    const result = await verifyIdToken(TOKEN);

    expect(result.error).toMatch(/expired/i);
  });

  test('rejects a token without a subject', async () => {
    const payload = goodPayload();
    delete payload.sub;
    fetchMock.mockReturnValue(respond(payload));

    const result = await verifyIdToken(TOKEN);

    expect(result.error).toMatch(/subject/i);
  });

  test('rejects an empty subject', async () => {
    fetchMock.mockReturnValue(respond(goodPayload({ sub: '   ' })));

    const result = await verifyIdToken(TOKEN);

    expect(result.error).toMatch(/subject/i);
  });

  test('rejects an unverified email', async () => {
    fetchMock.mockReturnValue(respond(goodPayload({ email_verified: 'false' })));

    const result = await verifyIdToken(TOKEN);

    expect(result.error).toMatch(/verified/i);
  });

  test('rejects a token with no email_verified claim', async () => {
    const payload = goodPayload();
    delete payload.email_verified;
    fetchMock.mockReturnValue(respond(payload));

    const result = await verifyIdToken(TOKEN);

    expect(result.error).toMatch(/verified/i);
  });

  test('rejects a non-200 tokeninfo response', async () => {
    fetchMock.mockReturnValue(respond({ error: 'invalid_token' }, { ok: false, status: 400 }));

    const result = await verifyIdToken(TOKEN);

    expect(result.error).toMatch(/invalid google token/i);
  });

  test('rejects when Google is unreachable or times out', async () => {
    const err = new Error('The operation was aborted due to timeout');
    err.name = 'TimeoutError';
    fetchMock.mockRejectedValue(err);

    const result = await verifyIdToken(TOKEN);

    expect(result.error).toMatch(/unavailable/i);
  });

  test('fails closed without calling Google when the client ID is missing', async () => {
    delete process.env.GOOGLE_CLIENT_ID;

    const result = await verifyIdToken(TOKEN);

    expect(result.statusCode).toBe(503);
    expect(result.error).toMatch(/not configured/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('rejects a malformed (non-JSON) tokeninfo response', async () => {
    fetchMock.mockReturnValue(Promise.resolve({
      ok: true,
      status: 200,
      json: async () => { throw new SyntaxError('Unexpected token'); }
    }));

    const result = await verifyIdToken(TOKEN);

    expect(result.error).toMatch(/invalid google token/i);
  });

  test('rejects a malformed (null) tokeninfo payload', async () => {
    fetchMock.mockReturnValue(respond(null));

    const result = await verifyIdToken(TOKEN);

    expect(result.error).toMatch(/invalid google token/i);
  });

  test('rejects a missing or non-string idToken without calling Google', async () => {
    expect((await verifyIdToken(undefined)).error).toMatch(/required/i);
    expect((await verifyIdToken('')).error).toMatch(/required/i);
    expect((await verifyIdToken({ sub: 'x' })).error).toMatch(/required/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
