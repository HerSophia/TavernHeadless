export class RuntimeJobRetryableError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "RuntimeJobRetryableError";
  }
}

export class RuntimeJobFatalError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "RuntimeJobFatalError";
  }
}

export class RuntimeJobUncertainOutcomeError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "RuntimeJobUncertainOutcomeError";
  }
}

export class RuntimeJobLeaseLostError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "RuntimeJobLeaseLostError";
  }
}
