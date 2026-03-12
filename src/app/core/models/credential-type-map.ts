import { CredentialType } from "./verifiable-credential";

export interface CredentialMapConfig {
  icon: string;
}

export const CredentialTypeMap: Record<CredentialType, CredentialMapConfig> = {
  'learcredential.employee.w3c.4': { icon: 'assets/icons/LearCredentialEmployee.png' },
  'learcredential.employee.sd.1':  { icon: 'assets/icons/LearCredentialEmployee.png' },
  'learcredential.machine.w3c.3':  { icon: 'assets/icons/LearCredentialMachine.png' },
  'learcredential.machine.sd.1':   { icon: 'assets/icons/LearCredentialMachine.png' },
  'gx.labelcredential.w3c.1':      { icon: 'assets/icons/LabelCredential.png' },
};