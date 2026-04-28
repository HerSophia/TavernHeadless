export class ChatServiceError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public override readonly cause?: unknown,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "ChatServiceError";
  }
}
