/**
 * Service for mapping applications to appropriate writing tones
 */

export type ToneProfile = {
  name: string;
  systemPromptHint: string;
  temperature: number;
  description: string;
};

export const TONE_PROFILES: Record<string, ToneProfile> = {
  formal: {
    name: "formal",
    systemPromptHint: "Use professional, formal language appropriate for business communication.",
    temperature: 0.2,
    description: "Professional and formal tone for business emails and documents",
  },
  casual: {
    name: "casual",
    systemPromptHint: "Use casual, conversational language as if talking to a friend.",
    temperature: 0.4,
    description: "Casual and friendly tone for personal messaging",
  },
  technical: {
    name: "technical",
    systemPromptHint: "Use clear, precise technical language. Be concise and accurate.",
    temperature: 0.1,
    description: "Technical and precise tone for code and documentation",
  },
  creative: {
    name: "creative",
    systemPromptHint: "Be creative and expressive. Use varied vocabulary and natural flow.",
    temperature: 0.6,
    description: "Creative and expressive tone for writing and content creation",
  },
  neutral: {
    name: "neutral",
    systemPromptHint: "Use clear, neutral language without strong formality or informality.",
    temperature: 0.3,
    description: "Balanced neutral tone for general use",
  },
};

type AppPattern = {
  pattern: RegExp;
  tone: keyof typeof TONE_PROFILES;
  description: string;
};

const CODING_ENVIRONMENT_APP_PATTERN =
  /(^|[^a-z])(code|cursor|windsurf|zed)([^a-z]|$)/i;
const CODING_ENVIRONMENT_NAME_PATTERN =
  /visual studio code|vscode|code - insiders|code insiders|sublime|atom|vim|nvim|emacs|intellij|pycharm|webstorm|goland|clion|phpstorm|rubymine|rider|android studio|xcode|nova/i;

export function isCodingEnvironmentContext(
  appName: string,
  windowTitle?: string,
): boolean {
  return (
    CODING_ENVIRONMENT_APP_PATTERN.test(appName) ||
    CODING_ENVIRONMENT_NAME_PATTERN.test(appName) ||
    (typeof windowTitle === "string" &&
      CODING_ENVIRONMENT_NAME_PATTERN.test(windowTitle))
  );
}

/**
 * Application patterns mapped to tone profiles
 * Patterns are checked in order, first match wins
 */
const APP_PATTERNS: AppPattern[] = [
  // Email clients - Formal
  {
    pattern: /outlook|mail|thunderbird|airmail|spark|postbox/i,
    tone: "formal",
    description: "Email clients",
  },
  {
    pattern: /gmail|protonmail|fastmail/i,
    tone: "formal",
    description: "Web-based email",
  },

  // Messaging apps - Casual
  {
    pattern: /messages|imessage|whatsapp|telegram|signal|slack|discord|teams/i,
    tone: "casual",
    description: "Messaging applications",
  },
  {
    pattern: /messenger|facebook|instagram|twitter|x\.com|social/i,
    tone: "casual",
    description: "Social media",
  },

  // Development tools - Technical
  {
    pattern: /vscode|visual studio code|code|sublime|atom|vim|nvim|emacs|intellij|pycharm|webstorm|android studio|xcode/i,
    tone: "technical",
    description: "Code editors and IDEs",
  },
  {
    pattern: /terminal|iterm|warp|hyper|alacritty|kitty|cmd|powershell|command prompt|console/i,
    tone: "technical",
    description: "Terminal applications",
  },
  {
    pattern: /github|gitlab|bitbucket|notion|obsidian|confluence/i,
    tone: "technical",
    description: "Development platforms and documentation",
  },

  // Creative writing - Creative
  {
    pattern: /word|pages|docs|google docs|scrivener|ulysses|ia writer|bear|draft/i,
    tone: "creative",
    description: "Word processors and writing apps",
  },
  {
    pattern: /notes|simplenote|evernote|onenote|apple notes/i,
    tone: "creative",
    description: "Note-taking apps",
  },

  // Professional documents - Formal
  {
    pattern: /excel|sheets|numbers|powerpoint|keynote|slides|google slides/i,
    tone: "formal",
    description: "Office productivity apps",
  },

  // Browsers with specific patterns - Check window title for context
  {
    pattern: /chrome|firefox|safari|edge|brave|opera|vivaldi/i,
    tone: "neutral",
    description: "Web browsers (default to neutral, can be refined by window title)",
  },
];

/**
 * Window title patterns for additional context
 * Used to refine tone when app name alone isn't enough (e.g., browsers)
 */
const WINDOW_TITLE_PATTERNS: AppPattern[] = [
  {
    pattern: /gmail|inbox|mail|outlook\.com|proton\.me/i,
    tone: "formal",
    description: "Email in browser",
  },
  {
    pattern: /slack|discord|messenger|whatsapp|telegram/i,
    tone: "casual",
    description: "Messaging in browser",
  },
  {
    pattern: /github|stackoverflow|developer|documentation|docs/i,
    tone: "technical",
    description: "Development sites",
  },
  {
    pattern: /google docs|notion|medium|substack/i,
    tone: "creative",
    description: "Writing platforms",
  },
];

export class AppToneService {
  /**
   * Determine the appropriate tone profile based on application context
   */
  static getToneProfile(appName: string, windowTitle?: string): ToneProfile {
    // First, try to match based on app name
    for (const pattern of APP_PATTERNS) {
      if (pattern.pattern.test(appName)) {
        // If it's a browser and we have a window title, try to refine further
        if (/chrome|firefox|safari|edge|brave|opera|vivaldi/i.test(appName) && windowTitle) {
          const refinedTone = this.getToneFromWindowTitle(windowTitle);
          if (refinedTone) {
            return TONE_PROFILES[refinedTone];
          }
        }
        return TONE_PROFILES[pattern.tone];
      }
    }

    // If no app pattern matched but we have a window title, try that
    if (windowTitle) {
      const titleTone = this.getToneFromWindowTitle(windowTitle);
      if (titleTone) {
        return TONE_PROFILES[titleTone];
      }
    }

    // Default to neutral
    return TONE_PROFILES.neutral;
  }

  /**
   * Try to determine tone from window title alone
   */
  private static getToneFromWindowTitle(windowTitle: string): keyof typeof TONE_PROFILES | null {
    for (const pattern of WINDOW_TITLE_PATTERNS) {
      if (pattern.pattern.test(windowTitle)) {
        return pattern.tone;
      }
    }
    return null;
  }

  /**
   * Get a human-readable description of why a certain tone was chosen
   */
  static getToneRationale(appName: string, windowTitle?: string): string {
    // Check app patterns
    for (const pattern of APP_PATTERNS) {
      if (pattern.pattern.test(appName)) {
        // Check for browser refinement
        if (/chrome|firefox|safari|edge|brave|opera|vivaldi/i.test(appName) && windowTitle) {
          for (const titlePattern of WINDOW_TITLE_PATTERNS) {
            if (titlePattern.pattern.test(windowTitle)) {
              return `${titlePattern.description} (detected from window title)`;
            }
          }
        }
        return pattern.description;
      }
    }

    // Check window title patterns
    if (windowTitle) {
      for (const pattern of WINDOW_TITLE_PATTERNS) {
        if (pattern.pattern.test(windowTitle)) {
          return `${pattern.description} (detected from window title)`;
        }
      }
    }

    return "No specific app detected, using neutral tone";
  }
}
