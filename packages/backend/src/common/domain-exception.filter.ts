import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { BackfillConflictError, CandleError } from '../domain/candle.js';
import { ConfigError } from '../domain/config.js';
import {
  IndicatorError,
  IndicatorInstanceNotFoundError,
  IndicatorNotFoundError,
} from '../domain/indicator.js';
import { ProfileConflictError, ProfileError, ProfileNotFoundError } from '../domain/profile.js';
import { RuleError, RuleNotFoundError, TickRuleNotEligibleError } from '../domain/rule.js';
import {
  MarketDataError,
  SymbolConflictError,
  SymbolError,
  SymbolNotFoundError,
} from '../domain/symbol.js';
import {
  TelegramDestinationError,
  TelegramDestinationNotFoundError,
} from '../domain/telegram-destination.js';
import type { ErrorResponse, FieldError } from './interfaces/error-response.types.js';

/**
 * The narrow slice of the platform HTTP response this filter drives — just
 * enough to send a JSON body with a status code, so the filter needs no
 * platform-specific (`express`) response type.
 */
interface JsonResponse {
  /** Set the HTTP status code, returning the response for chaining. */
  status(code: number): JsonResponse;
  /** Send `body` serialized as JSON. */
  json(body: ErrorResponse): void;
}

/**
 * The app-wide domain error → HTTP status mapping, applied globally.
 *
 * This is the keystone error contract every resource reuses; it reproduces the
 * old Fastify `setErrorHandler` exactly:
 *
 * - the domain not-found errors ({@link NOT_FOUND_ERRORS}) → **404**.
 * - the domain conflict errors ({@link CONFLICT_ERRORS}) → **409**.
 * - {@link TickRuleNotEligibleError} → **400** with one `fields[]` entry per
 *   unwatched symbol id.
 * - the domain client-input base errors ({@link ConfigError},
 *   {@link SymbolError}, {@link CandleError}, {@link ProfileError},
 *   {@link RuleError}, {@link IndicatorError}, {@link TelegramDestinationError})
 *   → **400**.
 * - {@link MarketDataError} → **502** (upstream provider fault, not our bug).
 * - anything else → **500** `{ error: 'Unexpected error' }`.
 *
 * {@link HttpException}s (raised by the framework or by the validation pipe,
 * which already carries the `{ error, fields }` envelope) pass through with
 * their own status and body.
 * The response body is always the uniform {@link ErrorResponse} envelope.
 */
@Catch()
export class DomainExceptionFilter implements ExceptionFilter {
  /** Scoped logger for the unexpected-fault and bad-gateway paths. */
  private readonly logger = new Logger(DomainExceptionFilter.name);

  /**
   * The domain not-found errors that map to a 404.
   * Explicit `instanceof` membership (not a name-suffix heuristic) so an infra
   * error that merely *happens* to end in `NotFoundError` — e.g. Mongoose's
   * `DocumentNotFoundError` — stays on the safe 500 path instead of leaking a
   * driver message as a 404.
   * Every domain error already lives in `core`, so a resource port needs no edit
   * here (the class is registered up-front).
   */
  private static readonly NOT_FOUND_ERRORS = [
    SymbolNotFoundError,
    ProfileNotFoundError,
    RuleNotFoundError,
    IndicatorNotFoundError,
    IndicatorInstanceNotFoundError,
    TelegramDestinationNotFoundError,
  ] as const;

  /**
   * The domain conflict errors that map to a 409.
   * Explicit membership, for the same reason as {@link NOT_FOUND_ERRORS}.
   */
  private static readonly CONFLICT_ERRORS = [
    SymbolConflictError,
    BackfillConflictError,
    ProfileConflictError,
  ] as const;

  /**
   * The domain client-input base errors that map to a 400.
   * A resource's not-found / conflict subclasses are handled by
   * {@link NOT_FOUND_ERRORS} / {@link CONFLICT_ERRORS} first, so a base-class
   * match here only catches the plain client-input failures.
   */
  private static readonly CLIENT_INPUT_ERRORS = [
    ConfigError,
    SymbolError,
    CandleError,
    ProfileError,
    RuleError,
    IndicatorError,
    TelegramDestinationError,
  ] as const;

  /**
   * Map the caught exception to a status + {@link ErrorResponse} body and send
   * it on the Express response.
   */
  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<JsonResponse>();
    const { status, body } = this.resolve(exception);
    response.status(status).json(body);
  }

  /**
   * Resolve the HTTP status and error body for a caught exception, following
   * the documented waterfall.
   */
  private resolve(exception: unknown): { status: number; body: ErrorResponse } {
    if (exception instanceof HttpException) {
      return { status: exception.getStatus(), body: httpExceptionBody(exception) };
    }
    if (exception instanceof Error) {
      if (DomainExceptionFilter.NOT_FOUND_ERRORS.some((type) => exception instanceof type)) {
        return { status: HttpStatus.NOT_FOUND, body: { error: exception.message } };
      }
      if (DomainExceptionFilter.CONFLICT_ERRORS.some((type) => exception instanceof type)) {
        return { status: HttpStatus.CONFLICT, body: { error: exception.message } };
      }
      if (exception instanceof TickRuleNotEligibleError) {
        return {
          status: HttpStatus.BAD_REQUEST,
          body: {
            error: exception.message,
            fields: exception.unwatchedSymbolIds.map((symbolId) => ({
              path: 'scope.symbolId',
              message: `symbol not on watchlist: ${symbolId}`,
            })),
          },
        };
      }
      if (DomainExceptionFilter.CLIENT_INPUT_ERRORS.some((type) => exception instanceof type)) {
        return { status: HttpStatus.BAD_REQUEST, body: { error: exception.message } };
      }
      if (exception instanceof MarketDataError) {
        // Upstream market-data provider failed — a bad gateway, not a bug.
        this.logger.warn(`market-data source failed: ${exception.message}`);
        return { status: HttpStatus.BAD_GATEWAY, body: { error: exception.message } };
      }
    }
    this.logger.error(exception);
    return { status: HttpStatus.INTERNAL_SERVER_ERROR, body: { error: 'Unexpected error' } };
  }
}

/**
 * Normalize a framework/pipe {@link HttpException} into the uniform
 * {@link ErrorResponse} envelope.
 *
 * The validation pipe already throws with a `{ error, fields }` body, so that
 * shape passes through untouched; Nest's own exceptions (`{ statusCode,
 * message, error }` or a bare string) collapse to `{ error: <message> }`.
 */
function httpExceptionBody(exception: HttpException): ErrorResponse {
  const response = exception.getResponse();
  if (typeof response === 'string') {
    return { error: response };
  }
  const record = response as Record<string, unknown>;
  if (typeof record.error === 'string') {
    return isFieldErrorArray(record.fields)
      ? { error: record.error, fields: record.fields }
      : { error: record.error };
  }
  const message = record.message;
  const error = Array.isArray(message)
    ? message.join(', ')
    : typeof message === 'string'
      ? message
      : exception.message;
  return { error };
}

/**
 * Narrow an unknown value to a {@link FieldError} array (the validation pipe's
 * `fields` payload).
 */
function isFieldErrorArray(value: unknown): value is FieldError[] {
  return (
    Array.isArray(value) &&
    value.every(
      (entry) =>
        entry !== null &&
        typeof entry === 'object' &&
        typeof (entry as FieldError).path === 'string' &&
        typeof (entry as FieldError).message === 'string',
    )
  );
}
