export interface Power {
  function: string;
  action: string[];
}

export interface CredentialPreview {
  power: Power[];
  subjectName: string;
  organization: string;
  expirationDate: string;
}
