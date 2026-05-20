function errorHandler(err, req, res, next) {
  console.error('[ERROR]', err);

  if (err.type === 'validation') {
    return res.status(400).json({
      success: false,
      data: null,
      error: { code: 'VALIDATION_ERROR', message: err.message || 'Validation error' }
    });
  }

  if (err.type === 'not_found') {
    return res.status(404).json({
      success: false,
      data: null,
      error: { code: 'NOT_FOUND', message: err.message || 'Resource not found' }
    });
  }

  if (err.type === 'conflict') {
    return res.status(409).json({
      success: false,
      data: null,
      error: { code: 'CONFLICT', message: err.message || 'Conflict' }
    });
  }

  res.status(500).json({
    success: false,
    data: null,
    error: { code: 'INTERNAL_ERROR', message: 'Internal server error' }
  });
}

module.exports = errorHandler;
