const crypto = require('crypto');

// Fields that change on every response and defeat caching; excluded from
// the ETag computation. The API contract is unchanged — responses still
// include these fields, only the conditional-request hash ignores them.
const VOLATILE_FIELDS = ['time'];

function _normalize(body) {
  if (Array.isArray(body)) return body.map(_normalize);
  if (body && typeof body === 'object') {
    const out = {};
    for (const key of Object.keys(body).sort()) {
      if (VOLATILE_FIELDS.includes(key)) continue;
      out[key] = _normalize(body[key]);
    }
    return out;
  }
  return body === undefined ? null : body;
}

// Generate an ETag from serialized JSON body (truncated SHA-256).
function generateETag(body) {
  const hash = crypto.createHash('sha256').update(JSON.stringify(_normalize(body))).digest('hex');
  return `"${hash.substring(0, 16)}"`;
}

// Middleware: attaches an ETag to GET responses and honors If-None-Match.
// ETags change with every mutation (the body hash reflects current state),
// so stale caches are automatically invalidated without extra logic.
function etagMiddleware(req, res, next) {
  if (req.method !== 'GET') return next();

  const originalJson = res.json.bind(res);
  res.json = function (body) {
    const etag = generateETag(body);
    res.setHeader('ETag', etag);

    const ifNoneMatch = req.headers['if-none-match'];
    if (ifNoneMatch && ifNoneMatch.trim() === etag) {
      res.statusCode = 304;
      return res.end();
    }

    return originalJson.call(res, body);
  };
  return next();
}

module.exports = { etagMiddleware, generateETag };