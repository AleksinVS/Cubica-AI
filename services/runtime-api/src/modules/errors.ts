export class HttpError extends Error {
  readonly statusCode: number;

  constructor(statusCode: number, message: string) {
    super(message);
    this.name = "HttpError";
    this.statusCode = statusCode;
  }
}

export class RequestValidationError extends HttpError {
  constructor(message: string) {
    super(400, message);
    this.name = "RequestValidationError";
  }
}

export class NotFoundError extends HttpError {
  constructor(message: string) {
    super(404, message);
    this.name = "NotFoundError";
  }
}

export class ManifestValidationError extends HttpError {
  constructor(message: string) {
    super(500, message);
    this.name = "ManifestValidationError";
  }
}
