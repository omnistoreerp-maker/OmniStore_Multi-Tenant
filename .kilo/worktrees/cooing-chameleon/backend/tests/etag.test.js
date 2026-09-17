// ETag middleware unit tests.
const { generateETag, etagMiddleware } = require('../middleware/etag');

describe('generateETag', () => {
  test('produces a quoted 16-char hash', () => {
    const etag = generateETag({ id: 1 });
    expect(etag).toMatch(/^"[0-9a-f]{16}"$/);
  });

  test('is deterministic for identical bodies', () => {
    expect(generateETag({ a: 1, b: 2 })).toBe(generateETag({ a: 1, b: 2 }));
  });

  test('differs for different bodies', () => {
    expect(generateETag({ a: 1 })).not.toBe(generateETag({ a: 2 }));
  });

  test('handles arrays and nested objects', () => {
    const etag = generateETag([{ x: 1 }, { y: 2 }]);
    expect(etag).toMatch(/^"[0-9a-f]{16}"$/);
  });
});

describe('etagMiddleware', () => {
  function mockRes() {
    const state = { headers: {}, body: null, statusCode: 200, ended: false };
    const res = {
      setHeader: (k, v) => { state.headers[k] = v; },
      get statusCode() { return state.statusCode; },
      set statusCode(v) { state.statusCode = v; },
      status: (code) => { state.statusCode = code; return res; },
      json: (body) => { state.body = body; return res; },
      end: () => { state.ended = true; return res; },
      _state: state
    };
    return { res, state };
  }

  test('skips non-GET methods', () => {
    const { res, state } = mockRes();
    let nextCalled = false;
    const next = () => { nextCalled = true; };
    etagMiddleware({ method: 'POST', headers: {} }, res, next);
    expect(nextCalled).toBe(true);
    // res.json is untouched for POST
    expect(state.body).toBeNull();
  });

  test('sets ETag header on GET responses', () => {
    const { res, state } = mockRes();
    etagMiddleware({ method: 'GET', headers: {} }, res, () => {});
    res.json({ id: 1 });
    expect(state.headers['ETag']).toBeTruthy();
    expect(state.body).toEqual({ id: 1 });
  });

  test('returns 304 when If-None-Match matches', () => {
    const { res, state } = mockRes();
    res.setHeader = (k, v) => { state.headers[k] = v; };
    etagMiddleware({ method: 'GET', headers: {} }, res, () => {});
    res.json({ id: 1 });
    const etag = state.headers['ETag'];

    const m2 = mockRes();
    const res2 = m2.res;
    const state2 = m2.state;
    etagMiddleware({ method: 'GET', headers: { 'if-none-match': etag } }, res2, () => {});
    res2.json({ id: 1 });
    expect(state2.statusCode).toBe(304);
    expect(state2.ended).toBe(true);
    expect(state2.body).toBeNull();
  });

  test('returns 200 when If-None-Match differs', () => {
    const m = mockRes();
    const res = m.res;
    const state = m.state;
    etagMiddleware({ method: 'GET', headers: { 'if-none-match': '"different"' } }, res, () => {});
    res.json({ id: 1 });
    expect(state.statusCode).toBe(200);
    expect(state.body).toEqual({ id: 1 });
  });
});