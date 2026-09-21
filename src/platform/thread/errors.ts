export class ThreadAccessError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ThreadAccessError";
  }
}

export class ThreadClosedError extends Error {
  constructor(threadId: string) {
    super(`Thread ${threadId} is closed`);
    this.name = "ThreadClosedError";
  }
}

export class ThreadNotFoundError extends Error {
  constructor(threadId: string) {
    super(`Thread ${threadId} not found`);
    this.name = "ThreadNotFoundError";
  }
}

export class EscalationTargetNotRegistered extends Error {
  constructor() {
    super("No escalation target is registered (the feature runtime registers one)");
    this.name = "EscalationTargetNotRegistered";
  }
}
