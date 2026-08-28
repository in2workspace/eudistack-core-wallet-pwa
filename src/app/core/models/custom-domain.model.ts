export interface CustomDomainEntry {
  tenantId: string;
  envId: string;
}

export interface CustomDomainEnv {
  issuer: string;
  verifier: string;
  wallet: string;
}

export interface CustomDomainTenantConfig {
  defaultEnv: string;
  env: Record<string, CustomDomainEnv>;
}

export interface CustomDomainConfig {
  domains: Record<string, CustomDomainEntry>;
  tenants: Record<string, CustomDomainTenantConfig>;
}
