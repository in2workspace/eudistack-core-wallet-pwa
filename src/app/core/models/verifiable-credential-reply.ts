import { DcqlQuery } from '../protocol/oid4vp/authorization-request.model';

export interface VCReply {
    selectedVcList: any[];
    nonce: string;
    state: string;
    redirectUri: string;
    clientId?: string;
    clientName?: string;
    dcqlQuery?: DcqlQuery;
  }
