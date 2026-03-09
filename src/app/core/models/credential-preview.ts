import { DisplayField } from './display-field.model';

export interface CredentialPreview {
  displayName: string;
  format: string;
  fields: DisplayField[];
  expirationDate: string;
}