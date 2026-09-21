export class DocumentAccessError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DocumentAccessError";
  }
}

export class DocumentNotFoundError extends Error {
  constructor(id: string) {
    super(`Document ${id} not found`);
    this.name = "DocumentNotFoundError";
  }
}

export class DocumentLockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DocumentLockedError";
  }
}
