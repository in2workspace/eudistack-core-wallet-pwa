export interface Theme {
  tenantDomain: string;
  branding: {
    name: string;
    primaryColor: string;
    primaryContrastColor: string;
    secondaryColor: string;
    secondaryContrastColor: string;
    logoUrl: string | null;
    logoDarkUrl: string | null;
    faviconUrl: string | null;
    pwaIconUrl: string | null;

    /** Optional per-context color overrides. All fields fallback to primary/secondary when omitted. */
    card?: {
      background?: string;
      gradientEnd?: string;
      text?: string;
    };
    auth?: {
      background?: string;
      gradientEnd?: string;
    };
  };
  content: {
    links: { label: string; url: string }[];
    footer: string | null;
    knowledgeBaseUrl?: string | null;

    // --- EUD-135 (AD-4) ---
    /** Tenant support mailbox. Overrides SUPPORT_EMAIL when present and schema-valid. */
    supportEmail?: string | null;
    /** Tenant issue tracker (https only). Overrides ISSUE_TRACKER_URL when present and schema-valid. */
    issueTrackerUrl?: string | null;

    // --- Fields already present in some tenants' theme.json (e.g. cgcom), previously undeclared ---
    /** @deprecated Legacy field. NOT consumed by the About section (EUD-135) — see supportEmail/issueTrackerUrl. Declared to keep the model honest. */
    supportUrl?: string | null;
    walletUrl?: string | null;
    walletUrlTest?: string | null;
    showWalletUrlTest?: boolean;
  };
  i18n: {
    defaultLang: string;
    available: string[];
  };
}
