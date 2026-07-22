export type ActivityType = 'issued' | 'presented' | 'deleted';

export interface ActivityEntry {
  id: string;
  type: ActivityType;
  credentialName: string;
  counterparty: string;
  timestamp: number;
  details?: string;
  sharedAttributes?: string[];
}

export type ActivityFilter = ActivityType | 'all';

export const ACTIVITY_FILTERS: ActivityFilter[] = ['all', 'issued', 'presented', 'deleted'];

/** Wire types: match `com.eudistack.ebw.domain.model.ActivityType` (eudistack-core-wallet-ebw). */
export type ServerActivityType = 'ISSUED' | 'PRESENTED' | 'DELETED';

/** Body sent on `POST /api/v1/activity` — matches `RecordActivityRequest` (ebw). No client-supplied timestamp: the server always sets `created_at` server-side. */
export interface ServerActivityRequestDto {
  id: string;
  type: ServerActivityType;
  credential_name: string;
  counterparty: string;
  details?: string;
  shared_attributes?: string[];
}

/** Body returned by `GET`/`POST /api/v1/activity` — matches `ActivityResponse` (ebw). */
export interface ServerActivityDto extends ServerActivityRequestDto {
  created_at: string;
}

const ACTIVITY_TYPE_TO_SERVER: Record<ActivityType, ServerActivityType> = {
  issued: 'ISSUED',
  presented: 'PRESENTED',
  deleted: 'DELETED',
};

const ACTIVITY_TYPE_FROM_SERVER: Record<ServerActivityType, ActivityType> = {
  ISSUED: 'issued',
  PRESENTED: 'presented',
  DELETED: 'deleted',
};

export function toServerActivityType(type: ActivityType): ServerActivityType {
  return ACTIVITY_TYPE_TO_SERVER[type];
}

export function fromServerActivityType(type: ServerActivityType): ActivityType {
  return ACTIVITY_TYPE_FROM_SERVER[type];
}

export function toServerActivityRequest(entry: ActivityEntry): ServerActivityRequestDto {
  return {
    id: entry.id,
    type: toServerActivityType(entry.type),
    credential_name: entry.credentialName,
    counterparty: entry.counterparty,
    details: entry.details,
    shared_attributes: entry.sharedAttributes,
  };
}

export function fromServerActivityDto(dto: ServerActivityDto): ActivityEntry {
  return {
    id: dto.id,
    type: fromServerActivityType(dto.type),
    credentialName: dto.credential_name,
    counterparty: dto.counterparty,
    timestamp: Date.parse(dto.created_at),
    details: dto.details,
    sharedAttributes: dto.shared_attributes,
  };
}
