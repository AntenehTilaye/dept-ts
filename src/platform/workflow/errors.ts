// Typed engine errors. Callers map them to action results (validation vs conflict vs forbidden).

export class WorkflowError extends Error {
  constructor(
    message: string,
    public readonly code: string,
  ) {
    super(message);
    this.name = "WorkflowError";
  }
}

export class UnknownTransitionError extends WorkflowError {
  constructor(key: string) {
    super(`Unknown transition "${key}"`, "unknown_transition");
  }
}

export class TransitionNotAllowedError extends WorkflowError {
  constructor(message: string) {
    super(message, "transition_not_allowed");
  }
}

export class RequiredInputError extends WorkflowError {
  constructor(
    message: string,
    public readonly missing: { comment?: boolean; fields?: string[]; attachments?: string[] },
  ) {
    super(message, "required_input");
  }
}

export class GuardFailedError extends WorkflowError {
  constructor(
    public readonly guard: string,
    reason?: string,
  ) {
    super(`Guard "${guard}" failed${reason ? `: ${reason}` : ""}`, "guard_failed");
  }
}

export class ConflictError extends WorkflowError {
  constructor(message = "The record was changed by someone else; reload and try again") {
    super(message, "conflict");
  }
}

export class ForbiddenTransitionError extends WorkflowError {
  constructor(message: string) {
    super(message, "forbidden");
  }
}
