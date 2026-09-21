// Auth error types shared by server-only helpers and framework-free handlers/tests.

export class UnauthenticatedError extends Error {
  constructor() {
    super("Not signed in");
    this.name = "UnauthenticatedError";
  }
}

export class ForbiddenError extends Error {
  constructor(message = "Forbidden") {
    super(message);
    this.name = "ForbiddenError";
  }
}
