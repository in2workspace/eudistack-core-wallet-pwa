export interface CredentialResponse {
  credentials?: { credential: string }[];
  transaction_id?: string;
  notification_id?: string;
  c_nonce?: string;
  c_nonce_expires_in?: number;
}