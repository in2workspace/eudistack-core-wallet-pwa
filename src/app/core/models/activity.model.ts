export type ActivityType = 'issued' | 'presented' | 'deleted';

export interface ActivityEntry {
  id: string;
  type: ActivityType;
  credentialName: string;
  counterparty: string;
  timestamp: number;
  details?: string;
}
