
import { AppError } from "src/app/core/models/error/AppError";


export type Oid4vciErrorCode =
  | 'unknown'
  | 'user_cancelled'
  | 'credential_offer_expired'
  | 'credential_offer_not_found'
  | 'credential_already_issued';

export class Oid4vciError extends AppError {
  public override readonly code: Oid4vciErrorCode;

  constructor(
    message: string,
    opts?: {
      code?: Oid4vciErrorCode;
      cause?: unknown;
      translationKey?: string;
      translationParams?: Record<string, unknown>;
    }
  ) {
    super(message, opts);
    this.code = opts?.code ?? 'unknown';
  }
}

/** The Issuer answered `credential_offer_expired` (HTTP 410): expired or already consumed offer. */
export class CredentialOfferExpiredError extends Oid4vciError {
  public constructor(cause?: unknown) {
    super('Credential offer expired', {
      code: 'credential_offer_expired',
      cause,
      translationKey: 'errors.credential-offer-expired',
    });
  }
}

/** The Issuer answered `credential_offer_not_found` (HTTP 404): the offer never existed or was purged. */
export class CredentialOfferNotFoundError extends Oid4vciError {
  public constructor(cause?: unknown) {
    super('Credential offer not found', {
      code: 'credential_offer_not_found',
      cause,
      translationKey: 'errors.credential-offer-not-found',
    });
  }
}

/** The Issuer answered `credential_already_issued`: the credential was already delivered to the holder. */
export class CredentialAlreadyIssuedError extends Oid4vciError {
  public constructor(cause?: unknown) {
    super('Credential already issued', {
      code: 'credential_already_issued',
      cause,
      translationKey: 'errors.credential-already-issued',
    });
  }
}