function success(res, data = null, message = 'OK', statusCode = 200) {
  return res.status(statusCode).json({
    success: true,
    message,
    data,
    time: new Date().toISOString()
  });
}

function error(res, message = 'Internal Server Error', statusCode = 500, details = null) {
  return res.status(statusCode).json({
    success: false,
    message,
    statusCode,
    details,
    time: new Date().toISOString()
  });
}

module.exports = { success, error };
