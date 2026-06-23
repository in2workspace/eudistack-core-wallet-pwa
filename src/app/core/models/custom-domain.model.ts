export interface CustomDomainEntry {
  tenantId: string;
  envId: string;
}

export interface CustomDomainEnv {
  issuer: string;
  verifier: string;
  wallet: string;
}

export interface CustomDomainTenant {
  defaultEnv?: string;
  env: Record<string, CustomDomainEnv>;
}

export interface CustomDomainConfig {
  domains: Record<string, CustomDomainEntry>;
  tenants: Record<string, CustomDomainTenant>;
}
