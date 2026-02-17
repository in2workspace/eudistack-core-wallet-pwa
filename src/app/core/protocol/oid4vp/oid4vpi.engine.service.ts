import { inject, Injectable } from '@angular/core';
import { VCReply } from 'src/app/interfaces/verifiable-credential-reply';
import { DescriptorMap, PresentationSubmission, VerifiablePresentation } from './models/VerifiablePresentation';
import { HttpClient, HttpHeaders, HttpParams } from '@angular/common/http';
import { environment } from 'src/environments/environment';
import { WebCryptoKeyStorageProvider } from '../../spi-impl/web-crypto-key-storage.service';
import { firstValueFrom } from 'rxjs';
import { JwtService } from '../oid4vci/jwt.service';
import { v4 as uuidv4 } from "uuid";
import { SERVER_PATH } from 'src/app/constants/api.constants';

    const CUSTOMER_PRESENTATION_DEFINITION = "CustomerPresentationDefinition";
    const CUSTOMER_PRESENTATION_SUBMISSION = "CustomerPresentationSubmission";


@Injectable({
  providedIn: 'root'
})
export class Oid4vpiEngineService {

  private readonly http = inject(HttpClient);
  private readonly jwtService = inject(JwtService);
  private readonly keyStorageProvider = inject(WebCryptoKeyStorageProvider);

  //todo move here the logic to get the credentials to select (from vc selector page)

  public async buildVerifiablePresentationWithSelectedVCs(selectorResponse: VCReply){
    const aud = this.generateAudience();
    console.log("Audience: ", aud);

    const selectedVCs = await this.getVerifiableCredentials(selectorResponse);
    const selectedVC = selectedVCs[0]; //todo for now we take the first one
    console.log("Selected VC: ", selectedVC);

    const credentialPayload = this.jwtService.parseJwtPayload(selectedVC) as any;
    console.log("Credential payload: ", credentialPayload);

    const cnf = credentialPayload.cnf;
    console.log("Credential cnf: ", cnf);

    const credentialSubjectId = credentialPayload.vc.credentialSubject.id;
    console.log("Credential subject ID: ", credentialSubjectId);

    const verifiablPresentation = this.createVerifiablePresentation(selectedVC, cnf, aud);
    console.log("Unsigned Verifiable Presentation: ", verifiablPresentation);

    const issueTime = Math.floor(Date.now() / 1000);

    const vpJwtPayload = {
      id: verifiablPresentation.id,
      iss: credentialSubjectId,
      sub: credentialSubjectId,
      nbf: issueTime,
      iat: issueTime,
      exp: issueTime + (3 * 60),
      vp: verifiablPresentation,
      nonce: credentialPayload.vc.id
    }

    const publicKey = cnf.jwk;
    console.log("Public key from cnf: ", publicKey);

    const thumbprint = await this.keyStorageProvider.computeJwkThumbprint(publicKey);
    console.log("Computed thumbprint: ", thumbprint);

    const keyId = await this.keyStorageProvider.resolveKeyIdByKid(thumbprint);
    console.log("Resolved key ID: ", keyId);

    if (!keyId) {
      throw new Error(`No local key found for kid=${thumbprint}`);
    }

    const signedVpJwt = await this.signVpAsJwt(vpJwtPayload, keyId, thumbprint);
    console.log("Signed VP JWT: ", signedVpJwt);

    const presentationSubmissionJson = this.buildPresentationSubmissionJson(verifiablPresentation, [selectedVC]);
    console.log("Presentation Submission JSON: ", presentationSubmissionJson);

    const verifierResponse = await this.postAuthorizationResponse(
      selectorResponse.redirectUri,
      selectorResponse.state,
      signedVpJwt,
      presentationSubmissionJson,
      /* authorizationToken? */ undefined
    );

    console.log('Verifier response:', verifierResponse);
  }

  private buildDescriptorMapping(vp: VerifiablePresentation, vcJwts: string[]): DescriptorMap {
  if (!vcJwts.length) {
    throw new Error('No verifiable credentials provided');
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

  let body = new HttpParams()
    .set('state', state)
    .set('vp_token', vpJwt)
    .set('presentation_submission', presentationSubmissionJson);

  // Headers
  let headers = new HttpHeaders({
    'Content-Type': 'application/x-www-form-urlencoded'
  });

  // Only set Authorization if the verifier really requires it.
  // In browsers this usually triggers CORS preflight.
  if (authorizationToken) {
    headers = headers.set('Authorization', `Bearer ${authorizationToken}`);
  }

  console.log("Posting authorization response to URL: ", redirectUri);

  const resp = await firstValueFrom(
    this.http.post(redirectUri, body.toString(), {
      headers,
      responseType: 'text',
      observe: 'response'
    })
  );

  // If verifier returns a redirect Location, browsers may hide it due to CORS.
  // Still return body; caller can inspect resp.headers if available.
  return resp.body ?? '';
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
    const payload = this.jwtService.parseJwtPayload(vcJwt) as any;
    const vc = payload?.vc;

    if (!vc?.id) {
      throw new Error('VC JWT payload does not contain vc.id');
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
      throw new Error(`Unexpected signature length: ${signature.length} (expected 64 for ES256).`);
    }

    const encodedSignature = this.jwtService.base64UrlEncode(signature);
    return `${encodedHeader}.${encodedPayload}.${encodedSignature}`;
}


  private createVerifiablePresentation(credential: any, cnf: any, aud: string): VerifiablePresentation{
    //todo only add aud if not null
    return {
      id: uuidv4(),
      holder: cnf,
      '@context': ["https://www.w3.org/2018/credentials/v1"],
      type: ["VerifiablePresentation"],
      verifiableCredential: [credential],
      aud: aud
    }
  }
  
  //todo
  private getVerifiableCredentials(vcReply: VCReply): Promise<string[]>{
    return firstValueFrom(
      this.http.post<string[]>(
            environment.server_url +
            SERVER_PATH.VERIFIABLE_PRESENTATION,
            vcReply,
            {
              headers: new HttpHeaders({
                'Content-Type': 'application/json',
                'Allow-Control-Allow-Origin': '*',
              }),
            }
          )
    );
  }
  //todo review this
  private generateAudience(){
    return "https://self-issued.me/v2";
  }
}
