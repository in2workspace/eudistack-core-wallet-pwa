import { DisplayField, DisplaySection } from './display-field.model';

export interface CredentialPreview {
  displayName: string;
  format: string;
  fields: DisplayField[];
  sections: DisplaySection[];
  expirationDate: string;
}