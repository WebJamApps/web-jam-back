class ErrorHandler {
  static internalServerError(err, req, res, next) {
    res.status(500);
    res.send({
      error: res.error,
      explanation: err
    });
  }
}

module.exports = ErrorHandler;
