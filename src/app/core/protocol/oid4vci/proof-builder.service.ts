import { Injectable } from '@angular/core';
import { JWT_PROOF_CLAIM } from 'src/app/core/constants/jwt.constants';
import { ProofJwtHeaderAndPayload } from '../../models/ProofJwt';



@Injectable({
  providedIn: 'root'
})
export class ProofBuilderService {

  public createHeaderAndPayload(nonce: string, issuer: string, publicKeyJwk: JsonWebKey): ProofJwtHeaderAndPayload {
    const nowSeconds = Math.floor(Date.now() / 1000);
    const expSeconds = nowSeconds + 10 * 24 * 60 * 60;

    return {
      header: { alg: 'ES256', typ: JWT_PROOF_CLAIM, jwk: publicKeyJwk },
      payload: { aud: [issuer], iat: nowSeconds, exp: expSeconds, nonce },
    };
  }
  
}
