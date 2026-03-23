import { Mandatee, Power, CredentialSubject, CredentialType } from './verifiable-credential';

// Interfaces for the raw JSON of Mandatee and Power
interface RawMandatee {
  firstName?: string;
  first_name?: string;
  lastName?: string;
  last_name?: string;
  email?: string;
  nationality?: string;
}

interface RawPower {
  action?: string | string[];
  tmf_action?: string | string[];
  domain?: string;
  tmf_domain?: string;
  function?: string;
  tmf_function?: string;
  type?: string;
  tmf_type?: string;
}

export class VerifiableCredentialSubjectDataNormalizer {

  /**
   * Normalizes the complete LearCredentialEmployeeDataDetail object.
   * It applies normalization to the mandatee object and each element of the power array.
   */
  public normalizeLearCredentialSubject(data: CredentialSubject, type: CredentialType): CredentialSubject {
    return this.normalizerMapByCredentialType[type](data);
  }

  private normalizerMapByCredentialType: Record<CredentialType, (s: CredentialSubject) => CredentialSubject> = {
    'learcredential.employee.w3c.4': (s: CredentialSubject) => this.normalizeMandateSubject(s, true),
    'learcredential.employee.sd.1': (s: CredentialSubject) => this.normalizeMandateSubject(s, true),
    'learcredential.machine.w3c.3': (s: CredentialSubject) => this.normalizeMandateSubject(s, false),
    'learcredential.machine.sd.1': (s: CredentialSubject) => this.normalizeMandateSubject(s, false),
    'gx.labelcredential.w3c.1': (s: CredentialSubject) => s,
    'doctorid.sd.1': (s: CredentialSubject) => s
  } as const;

  /**
   * SD-JWT credentials place mandator/mandatee/power directly on credentialSubject
   * instead of nesting them under a `mandate` object (W3C format).
   * This wraps the flat structure so downstream code works uniformly.
   */
  private wrapFlatMandateStructure(data: any): void {
    if ('mandate' in data || !('mandator' in data || 'mandatee' in data || 'power' in data)) return;
    data.mandate = {
      ...(data.mandator ? { mandator: data.mandator } : {}),
      ...(data.mandatee ? { mandatee: data.mandatee } : {}),
      ...(data.power ? { power: data.power } : {}),
    };
    delete data.mandator;
    delete data.mandatee;
    delete data.power;
  }

  private normalizeMandateSubject(data: CredentialSubject, isEmployee: boolean): CredentialSubject {
    const normalizedData: any = { ...data };

    this.wrapFlatMandateStructure(normalizedData);

    if (!('mandate' in normalizedData) || !normalizedData.mandate) return normalizedData;

    const mandate = normalizedData.mandate;

    if (isEmployee && mandate.mandatee) {
      mandate.mandatee = this.normalizeMandatee(mandate.mandatee);
    }

    if (mandate.power && Array.isArray(mandate.power)) {
      mandate.power = mandate.power.map((p: RawPower) => this.normalizePower(p));
    }

    return normalizedData;
  }

  /**
 * Normalizes the mandatee object by unifying "firstName"/"first_name" and "lastName"/"last_name" keys.
 */
private normalizeMandatee(data: RawMandatee): Mandatee {
  return <Mandatee>{
    ...data,
    firstName: data.firstName ?? data.first_name,
    lastName: data.lastName ?? data.last_name,
    email: data.email
  };
}

/**
 * Normalizes a power object by unifying keys like "action"/"tmf_action", "domain"/"tmf_domain", etc.
 */
private normalizePower(data: RawPower): Power {
  return <Power>{
    action: data.action ?? data.tmf_action,
    domain: data.domain ?? data.tmf_domain,
    function: data.function ?? data.tmf_function,
    type: data.type ?? data.tmf_type
  };
}
}
