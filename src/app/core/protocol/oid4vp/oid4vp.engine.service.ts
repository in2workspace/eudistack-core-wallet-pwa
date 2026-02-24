import { inject, Injectable } from '@angular/core';
import { VCReply } from 'src/app/interfaces/verifiable-credential-reply';
import { HttpClient, HttpHeaders, HttpParams } from '@angular/common/http';
import { environment } from 'src/environments/environment';
import { WebCryptoKeyStorageProvider } from '../../spi-impl/web-crypto-key-storage.service';
import { firstValueFrom } from 'rxjs';
import { JwtService } from '../oid4vci/jwt.service';
import { v4 as uuidv4 } from "uuid";
import { SERVER_PATH } from 'src/app/constants/api.constants';
import { DescriptorMap, PresentationSubmission, VerifiablePresentation } from '../../models/VerifiablePresentation';
import { ToastServiceHandler } from 'src/app/services/toast.service';
import { LoaderService } from 'src/app/services/loader.service';
import { AppError } from 'src/app/interfaces/error/AppError';
import { Oid4vpError } from '../../models/error/Oid4vpError';
import { wrapOid4vpHttpError } from 'src/app/helpers/http-error-message';

    const CUSTOMER_PRESENTATION_DEFINITION = "CustomerPresentationDefinition";
    const CUSTOMER_PRESENTATION_SUBMISSION = "CustomerPresentationSubmission";


@Injectable({
  providedIn: 'root'
})
export class Oid4vpEngineService {

  private readonly http = inject(HttpClient);
  private readonly jwtService = inject(JwtService);
  private readonly keyStorageProvider = inject(WebCryptoKeyStorageProvider);
  private readonly loader = inject(LoaderService);
  private readonly toastServiceHandler = inject(ToastServiceHandler);

  //todo move here the logic to get the credentials to select (from vc selector page)

  public async buildVerifiablePresentationWithSelectedVCs(selectorResponse: VCReply): Promise<void> {
    try {
        this.loader.addLoadingProcess();

        const aud = this.generateAudience();
        console.log('Generated audience for VP:', aud);

        const selectedVCs = await this.getVerifiableCredentials(selectorResponse);
        const selectedVC = selectedVCs[0]; // todo: handle multiple
        console.log('Selected VC JWT:', selectedVC);

        if (!selectedVC) {
        throw new Oid4vpError('No VC available for presentation', {
            translationKey: 'errors.no-credentials-available',
        });
        }

        let credentialPayload: any;
        try {
        credentialPayload = this.jwtService.parseJwtPayload(selectedVC) as any;
        } catch (e: unknown) {
        // If you also have a JwtParseError here, you can mirror the OID4VCI logic.
        throw new Oid4vpError('Selected credential JWT payload could not be parsed', {
            cause: e,
            translationKey: 'errors.invalid-jwt',
        });
        }

        const cnf = credentialPayload?.cnf;
        console.log('Extracted cnf from credential payload:', cnf);
        if (!cnf?.jwk) {
          throw new Oid4vpError('Missing cnf.jwk in selected credential', {
              translationKey: 'errors.credential-validation-failed',
          });
        }
        console.log('Extracted JWK from cnf:', cnf.jwk);

        const credentialSubjectId = credentialPayload?.vc?.credentialSubject?.id;
        if (!credentialSubjectId) {
          throw new Oid4vpError('Missing vc.credentialSubject.id in selected credential', {
              translationKey: 'errors.credential-validation-failed',
          });
        }
        console.log('Extracted credentialSubjectId from credential payload:', credentialSubjectId);

        const verifiablePresentation = this.createVerifiablePresentation(selectedVC, cnf);
        console.log('Created verifiable presentation:', verifiablePresentation);

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
        console.log("Constructed VP JWT payload:", vpJwtPayload);

        const publicKey = cnf.jwk;
        const thumbprint = await this.keyStorageProvider.computeJwkThumbprint(publicKey);
        const keyId = await this.keyStorageProvider.resolveKeyIdByKid(thumbprint);

        if (!keyId) {
        throw new Oid4vpError(`No local key found for kid=${thumbprint}`, {
            translationKey: 'errors.key-not-found',
        });
        }
        const signedVpJwt = await this.signVpAsJwt(vpJwtPayload, keyId, thumbprint);
        console.log('Signed VP JWT:', signedVpJwt);

        const presentationSubmissionJson = this.buildPresentationSubmissionJson(verifiablePresentation, [selectedVC]);

        const verifierResponse = await this.postAuthorizationResponse(
            selectorResponse.redirectUri,
            selectorResponse.state,
            signedVpJwt,
            presentationSubmissionJson,
            undefined
        );

        console.log('Verifier response:', verifierResponse);
    } catch (e: unknown) {
        if (e instanceof AppError) {
            console.error('[Oid4vpEngine] Flow failed:', { message: e.message, code: e.code, cause: e.cause });
        } else {
            console.error('[Oid4vpEngine] Flow failed:', e);
        }

        const msg = this.errorToTranslationKey(e);
        if (msg) {
            this.toastServiceHandler.showErrorAlertByTranslateLabel(msg).subscribe();
        }

        throw e;
    } finally {
        this.loader.removeLoadingProcess();
    }
    }

  private errorToTranslationKey(e: unknown): string | null {
    if (e instanceof AppError) {
        if (e.code === 'user_cancelled') return null;
        return e.translationKey ?? 'errors.default';
    }
    return 'errors.default';
    }

  private buildDescriptorMapping(vp: VerifiablePresentation, vcJwts: string[]): DescriptorMap {
  if (!vcJwts.length) {
    throw new Oid4vpError('No verifiable credentials provided to build descriptor map', {
      translationKey: 'errors.no-credentials-available',
    });
  }

  const vcMaps: DescriptorMap[] = vcJwts.map((vcJwt, i) => ({
    format: 'jwt_vc',
    path: `$.verifiableCredential[${i}]`,
    id: this.getVcIdFromJwt(vcJwt),
    path_nested: null
  }));

  let chained: DescriptorMap = vcMaps[0];
  for (let i = 1; i < vcMaps.length; i++) {
    chained = {
      ...chained,
      path_nested: this.appendNested(chained.path_nested ?? null, vcMaps[i])
    };
  }

  return {
    format: 'jwt_vp',
    path: '$',
    id: vp.id,
    path_nested: chained
  };
}

private async postAuthorizationResponse(
  redirectUri: string,
  state: string,
  vpJwt: string,
  presentationSubmissionJson: string,
  authorizationToken?: string
): Promise<string> {
  const body = new HttpParams()
    .set('state', state)
    .set('vp_token', vpJwt)
    .set('presentation_submission', presentationSubmissionJson);
  console.log('Constructed authorization response body:', body.toString());

  let headers = new HttpHeaders({
    'Content-Type': 'application/x-www-form-urlencoded',
  });

  if (authorizationToken) {
    headers = headers.set('Authorization', `Bearer ${authorizationToken}`);
  }

  try {
    const resp = await firstValueFrom(
      this.http.post(redirectUri, body.toString(), {
        headers,
        responseType: 'text',
        observe: 'response',
      })
    );
    return resp.body ?? '';
  } catch (e: unknown) {
    wrapOid4vpHttpError(e, 'Failed to post authorization response to verifier', {
      translationKey: 'errors.verifier-post-failed',
    });
  }
}

private buildPresentationSubmissionJson(vp: VerifiablePresentation, vcJwts: string[]): string {
  const rootMap = this.buildDescriptorMapping(vp, vcJwts);

  const submission: PresentationSubmission = {
    id: CUSTOMER_PRESENTATION_SUBMISSION,
    definition_id: CUSTOMER_PRESENTATION_DEFINITION,
    descriptor_map: [rootMap]
  };

  return JSON.stringify(submission);
}

private appendNested(existing: DescriptorMap | null, next: DescriptorMap): DescriptorMap {
  if (!existing) return next;
  return {
    ...existing,
    path_nested: this.appendNested(existing.path_nested ?? null, next)
  };
}

  private getVcIdFromJwt(vcJwt: string): string {
    let payload: any;
    try {
        payload = this.jwtService.parseJwtPayload(vcJwt) as any;
    } catch (e: unknown) {
        throw new Oid4vpError('VC JWT payload could not be parsed', {
        cause: e,
        translationKey: 'errors.invalid-jwt',
        });
    }

    const vc = payload?.vc;
    if (!vc?.id) {
        throw new Oid4vpError('VC JWT payload does not contain vc.id', {
        translationKey: 'errors.credential-validation-failed',
        });
    }

    return vc.id;
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


  private createVerifiablePresentation(credential: any, cnf: any): VerifiablePresentation{
    return {
      id: uuidv4(),
      holder: cnf,
      '@context': ["https://www.w3.org/2018/credentials/v1"],
      type: ["VerifiablePresentation"],
      verifiableCredential: [credential],
    }
  }
  
  //todo
  private async getVerifiableCredentials(vcReply: VCReply): Promise<string[]> {
    try {
        return await firstValueFrom(
        this.http.post<string[]>(
            environment.server_url + SERVER_PATH.VERIFIABLE_PRESENTATION,
            vcReply,
            {
            headers: new HttpHeaders({
                'Content-Type': 'application/json',
            }),
            }
        )
        );
    } catch (e: unknown) {
        wrapOid4vpHttpError(e, 'Failed to obtain verifiable credentials for VP', {
        translationKey: 'errors.loading-VCs',
        });
    }
    }

  //todo review this
  private generateAudience(){
    return "https://self-issued.me/v2";
  }
}
