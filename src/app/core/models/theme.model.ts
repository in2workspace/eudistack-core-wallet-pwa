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
  };
  i18n: {
    defaultLang: string;
    available: string[];
  };
}
