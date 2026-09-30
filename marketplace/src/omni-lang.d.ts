/** Window typing for platform/omni-i18n.js (loaded as a plain script). */
export interface OmniLangGlobal {
  get: () => string;
  set: (lang: string) => void;
  dir?: () => string;
}

declare global {
  interface Window {
    OmniLang?: OmniLangGlobal;
  }
}

export {};
