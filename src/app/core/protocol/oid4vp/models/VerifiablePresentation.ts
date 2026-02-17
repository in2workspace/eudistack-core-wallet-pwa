export interface VerifiablePresentation {
  '@context': string[];
  id: string;
  type: string[];
  holder: string;
  verifiableCredential: string[];
  aud: string;
}
