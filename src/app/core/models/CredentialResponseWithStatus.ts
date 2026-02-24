import { CredentialResponse } from "./dto/CredentialResponse";

export interface CredentialResponseWithStatus {
  credentialResponse: CredentialResponse;
  status: number;
}

export interface CredentialResponseWithStatusCode {
  credentialResponse: CredentialResponse;
  statusCode: number;
}