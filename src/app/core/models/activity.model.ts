export type ActivityType = 'issued' | 'presented' | 'deleted';

export interface ActivityEntry {
  id: string;
  type: ActivityType;
  credentialName: string;
  counterparty: string;
  timestamp: number;
  details?: string;
}

export type ActivityFilter = ActivityType | 'all';

export const ACTIVITY_FILTERS: ActivityFilter[] = ['all', 'issued', 'presented', 'deleted'];
