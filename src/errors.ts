export type ErrorCode =
  | 'INVALID_JSON'
  | 'INVALID_INTEGER'
  | 'MODULUS_ZERO'
  | 'MODULUS_NEGATIVE'
  | 'INVALID_CONSTRAINTS'
  | 'RESOURCE_LIMIT_EXCEEDED'
  | 'CASE_NOT_FOUND'
  | 'VERSION_NOT_FOUND'
  | 'REPORT_NOT_FOUND'
  | 'NAME_CONFLICT'
  | 'INVALID_RANGE'
  | 'INVALID_ARGUMENT';

export class AppError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export function errorBody(code: ErrorCode, message: string, details?: unknown) {
  return { error: { code, message, details } };
}
