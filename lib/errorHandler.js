class ErrorHandler {
  constructor(){}

  internalServerError(err, req, res, next) {
    //TODO: Add more error handling filtering
    res.status(500);
    res.send({
      error: res.error,
      explanation: err
    });
  }

}

module.exports = ErrorHandler;
