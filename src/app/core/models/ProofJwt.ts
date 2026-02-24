import { JWT_PROOF_CLAIM } from "src/app/constants/jwt.constants";

export type ProofJwtContext = {
  jwt: string;
  publicKeyJwk: JsonWebKey;
  thumbprint: string;
};

export interface ProofJwtHeaderAndPayload {
  header: ProofJwtHeader;
  payload: ProofJwtPayload;
}

interface ProofJwtPayload {
  aud: string[];
  iat: number;
  exp: number;
  nonce: string;
}

interface ProofJwtHeader {
  alg: 'ES256';
  typ: typeof JWT_PROOF_CLAIM;
  jwk: JsonWebKey;
}