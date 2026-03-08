import { CredentialType } from "./verifiable-credential";

export interface FieldConfig {
  label: string;
  valueGetter: (subject: any) => string;
}

export interface CredentialMapConfig {
  icon: string;
  fields: FieldConfig[];
}

const employeeConfig: CredentialMapConfig = {
  icon: 'assets/icons/LearCredentialEmployee.png',
  fields: [
    { label: 'First Name', valueGetter: (s) => s.mandate.mandatee.firstName },
    { label: 'Last Name', valueGetter: (s) => s.mandate.mandatee.lastName },
    { label: 'Organization', valueGetter: (s) => s.mandate.mandator.organization }
  ],
};

const machineConfig: CredentialMapConfig = {
  icon: 'assets/icons/LearCredentialMachine.png',
  fields: [
    { label: 'IP Address', valueGetter: (s) => s.mandate.mandatee.ipAddress ?? '' },
    { label: 'Domain', valueGetter: (s) => s.mandate.mandatee.domain ?? '' },
    { label: 'Organization', valueGetter: (s) => s.mandate.mandator.organization }
  ],
};

const labelConfig: CredentialMapConfig = {
  icon: 'assets/icons/LabelCredential.png',
  fields: [
    { label: 'Label ID', valueGetter: (s) => {
      const id = s.id
      if (id) {
        const match = id.match(/^urn:ngsi-ld:([^:]+):/);
        return match ? match[1] : id;
      }
      return '';
    }},
    {
      label: 'Label Level',
      valueGetter: (s) => {
        const level = s['gx:labelLevel'];
        return level === 'BL' ? 'Base Line' : level;
      }
    }
  ],
};

// NOTE: W3C versions here (w3c.4, w3c.3) do not match the JSON schema profiles
// in src/assets/schemas/ which use w3c.1. The schema registry service also uses w3c.1.
// These versions are kept as-is because they reflect the credential_configuration_ids
// actually issued by the current issuer deployment. A full version alignment is pending.
// See also: verifiable-credential.ts CREDENTIAL_TYPES_ARRAY, credential-detail-map.ts,
// verifiable-credential-subject-data-normalizer.ts, credential-cache.service.ts.
export const CredentialTypeMap: Record<CredentialType, CredentialMapConfig> = {
  'learcredential.employee.w3c.4': employeeConfig,
  'learcredential.employee.sd.1': employeeConfig,
  'learcredential.machine.w3c.3': machineConfig,
  'learcredential.machine.sd.1': machineConfig,
  'gx.labelcredential.w3c.1': labelConfig,
};
