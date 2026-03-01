import { inject, Injectable } from '@angular/core';
import { VCReply } from 'src/app/core/models/verifiable-credential-reply';
import { KeyStorageProvider } from '../../spi/key-storage.provider.service';
import { firstValueFrom } from 'rxjs';
import { JwtService } from '../oid4vci/jwt.service';
import { v4 as uuidv4 } from "uuid";
import { VerifiablePresentation } from '../../models/VerifiablePresentation';
import { AppError } from 'src/app/core/models/error/AppError';
import { Oid4vpError } from '../../models/error/Oid4vpError';
import { wrapOid4vpHttpError } from 'src/app/shared/helpers/http-error-message';
import { WalletService } from 'src/app/core/services/wallet.service';
import { LoaderHandledFlowService } from 'src/app/shared/services/loader-handled-flow.service';
import { CredentialCacheService } from 'src/app/shared/services/credential-cache.service';

@Injectable({
  providedIn: 'root'
})
export class Oid4vpEngineService {

  private readonly jwtService = inject(JwtService);
  private readonly keyStorageProvider = inject(KeyStorageProvider);
  private readonly loaderHandledFlowService = inject(LoaderHandledFlowService);
  private readonly walletService = inject(WalletService);
  private readonly credentialCacheService = inject(CredentialCacheService);

  public async buildVerifiablePresentationWithSelectedVCs(selectorResponse: VCReply): Promise<void> {
    console.info('Starting OID4VP flow.');

    return this.loaderHandledFlowService.run({
      logPrefix: '[Oid4vpEngine]',
      errorToTranslationKey: (e) => this.errorToTranslationKey(e),
      fn: async () => {
        console.debug('[OID4VP] Step 1: Getting signed VC JWT from credential...');
        const selectedVC = this.getSignedVcJwt(selectorResponse);
        console.debug('[OID4VP] Step 1 OK: Got signed VC JWT');

        console.debug('[OID4VP] Step 2: Parsing VC JWT payload...');
        const credentialPayload = this.parseJwtPayloadOrThrow(selectedVC, 'Selected credential JWT payload could not be parsed');
        console.debug('[OID4VP] Step 2 OK: Parsed payload. Keys:', Object.keys(credentialPayload));

        console.debug('[OID4VP] Step 3: Checking cnf.jwk...');
        const cnf = credentialPayload?.cnf;
        if (!cnf?.jwk) {
          console.error('[OID4VP] FAIL: Missing cnf.jwk. cnf=', cnf, 'Full payload=', credentialPayload);
          throw new Oid4vpError('Missing cnf.jwk in selected credential', {
              translationKey: 'errors.credential-validation-failed',
          });
        }
        console.debug('[OID4VP] Step 3 OK: cnf.jwk present');

        console.debug('[OID4VP] Step 4: Checking credentialSubject.id...');
        const credentialSubjectId = credentialPayload?.vc?.credentialSubject?.id;
        if (!credentialSubjectId) {
          console.error('[OID4VP] FAIL: Missing vc.credentialSubject.id. vc=', credentialPayload?.vc);
          throw new Oid4vpError('Missing vc.credentialSubject.id in selected credential', {
              translationKey: 'errors.credential-validation-failed',
          });
        }
        console.debug('[OID4VP] Step 4 OK: credentialSubject.id=', credentialSubjectId);

        const verifiablePresentation = this.createVerifiablePresentation(selectedVC, credentialSubjectId);

        // OID4VP Final 1.0: aud MUST be client_id
        const aud = selectorResponse.clientId ?? selectorResponse.redirectUri;

        const issueTime = Math.floor(Date.now() / 1000);

        const vpJwtPayload = {
          id: verifiablePresentation.id,
          iss: credentialSubjectId,
          sub: credentialSubjectId,
          aud,
          nbf: issueTime,
          iat: issueTime,
          exp: issueTime + (3 * 60),
          vp: verifiablePresentation,
          nonce: selectorResponse.nonce,
        };

        console.debug('[OID4VP] Step 5: Resolving signing key...');
        const publicKey = cnf.jwk;
        const thumbprint = await this.keyStorageProvider.computeJwkThumbprint(publicKey);
        const keyId = await this.keyStorageProvider.resolveKeyIdByKid(thumbprint);

        if (!keyId) {
          console.error('[OID4VP] FAIL: No local key for thumbprint=', thumbprint);
          throw new Oid4vpError(`No local key found for kid=${thumbprint}`, {
            translationKey: 'errors.key-not-found',
          });
        }
        console.debug('[OID4VP] Step 5 OK: keyId resolved');

        console.debug('[OID4VP] Step 6: Signing VP JWT...');
        const signedVpJwt = await this.signVpAsJwt(vpJwtPayload, keyId, thumbprint);
        console.debug('[OID4VP] Step 6 OK: VP signed');

        // Build vp_token: Base64 encode because the verifier currently expects Base64.getDecoder().decode()
        const vpToken = this.buildVpToken(signedVpJwt, selectorResponse);

        console.debug('[OID4VP] Step 7: Posting auth response to', selectorResponse.redirectUri);
        await this.postAuthorizationResponse(
            selectorResponse.redirectUri,
            selectorResponse.state,
            vpToken
        );

        console.info('OID4VP flow completed successfully.');
      }});
    }

  private getSignedVcJwt(selectorResponse: VCReply): string {
    const selectedVc = selectorResponse.selectedVcList[0];

    if (!selectedVc) {
      throw new Oid4vpError('No VC available for presentation', {
          translationKey: 'errors.no-credentials-available',
      });
    }

    // Use credentialEncoded (the signed JWT) directly from the credential
    const signedJwt = this.credentialCacheService.getSignedJwt(selectedVc);
    if (!signedJwt) {
      throw new Oid4vpError('Selected credential does not have a signed JWT (credentialEncoded)', {
          translationKey: 'errors.credential-validation-failed',
      });
    }
    return signedJwt;
  }

  private buildVpToken(signedVpJwt: string, selectorResponse: VCReply): string {
    if (selectorResponse.dcqlQuery) {
      // DCQL format: { "credential_query_id": ["vp_jwt"] }
      // Use the first credential query ID from the DCQL query
      const credQueryId = selectorResponse.dcqlQuery.credentials[0]?.id ?? 'default';
      const dcqlVpToken = { [credQueryId]: [signedVpJwt] };
      return btoa(JSON.stringify(dcqlVpToken));
    }

    // Legacy format: just Base64-encode the JWT
    return btoa(signedVpJwt);
  }

  private errorToTranslationKey(e: unknown): string | null {
    if (e instanceof AppError) {
        if (e.code === 'user_cancelled') return null;
        return e.translationKey ?? 'errors.default';
    }
    return 'errors.default';
    }

  private async postAuthorizationResponse(
    redirectUri: string,
    state: string,
    vpToken: string
  ): Promise<string> {
    try {
       return await firstValueFrom(
        this.walletService.postOid4vpAuthorizationResponse(
          redirectUri,
          state,
          vpToken
        )
      );
    } catch (e: unknown) {
      wrapOid4vpHttpError(e, 'Failed to post authorization response to verifier', {
        translationKey: 'errors.verifier-post-failed',
      });
    }
  }

  private async signVpAsJwt(vpJwtPayload: {}, keyId: string, kid: string): Promise<string> {
    const header = {
      alg: 'ES256',
      typ: 'JWT',
      kid
    };

    const encodedHeader = this.jwtService.base64UrlEncode(new TextEncoder().encode(JSON.stringify(header)));
    const encodedPayload = this.jwtService.base64UrlEncode(new TextEncoder().encode(JSON.stringify(vpJwtPayload)));

    const signingInput = `${encodedHeader}.${encodedPayload}`;
    const signingBytes = new TextEncoder().encode(signingInput);

    const signature = await this.keyStorageProvider.sign(keyId, signingBytes);

    if (signature.length !== 64) {
        throw new Oid4vpError(`Unexpected signature length: ${signature.length}`, {
            translationKey: 'errors.browser-storage-operation-failed',
        });
        }

    const encodedSignature = this.jwtService.base64UrlEncode(signature);
    return `${encodedHeader}.${encodedPayload}.${encodedSignature}`;
  }

  private createVerifiablePresentation(credential: string, holderId: string): VerifiablePresentation {
    return {
      id: `urn:uuid:${uuidv4()}`,
      holder: holderId,
      '@context': ["https://www.w3.org/2018/credentials/v1"],
      type: ["VerifiablePresentation"],
      verifiableCredential: [credential],
    };
  }

  private parseJwtPayloadOrThrow(jwt: string, contextMsg: string): any {
    try {
      return this.jwtService.parseJwtPayload(jwt) as any;
    } catch (e: unknown) {
      throw new Oid4vpError(contextMsg, {
        cause: e,
        translationKey: 'errors.invalid-jwt',
      });
    }
  }
}
