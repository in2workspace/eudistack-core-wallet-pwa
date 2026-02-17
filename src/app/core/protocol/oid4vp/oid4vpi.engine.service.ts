import { inject, Injectable } from '@angular/core';
import { VCReply } from 'src/app/interfaces/verifiable-credential-reply';
import { VerifiablePresentation } from './models/VerifiablePresentation';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { environment } from 'src/environments/environment';
import { WebCryptoKeyStorageProvider } from '../../spi-impl/web-crypto-key-storage.service';
import { firstValueFrom } from 'rxjs';
import { JwtService } from '../oid4vci/jwt.service';
import { v4 as uuidv4 } from "uuid";
import { SERVER_PATH } from 'src/app/constants/api.constants';


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
    //todo
    //send signedVpJwt to Verifier
    
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
