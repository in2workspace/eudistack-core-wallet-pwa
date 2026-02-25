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

export interface NotificationData {
  decision: boolean;
  credentialPreview?: CredentialPreview;
  timeout?: number;
  expiresAt?: number;
}

export function isNotificationRequest(data: any): data is NotificationData {
  return data && typeof data.decision !== 'undefined';
}