  export interface CredentialRequest {
    format: string;
    credential_configuration_id: string;
    proof?: { proof_type: string; jwt: string; }; 
  } 