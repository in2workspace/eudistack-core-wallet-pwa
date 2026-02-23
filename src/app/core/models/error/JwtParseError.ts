export class JwtParseError extends Error {
  public readonly cause?: unknown;

  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = 'JwtParseError';
    this.cause = cause;
  }
}