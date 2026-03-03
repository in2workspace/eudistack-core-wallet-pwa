export interface Power {
  function: string;
  action: string[];
}

export interface PreviewField {
  label: string;
  value: string;
}

export interface CredentialPreview {
  displayName: string;
  format: string;
  fields: PreviewField[];
  power: Power[];
  subjectName: string;
  organization: string;
  expirationDate: string;
}
