/**
 * Effective font configuration resolved by the Java backend.
 * Shared across global.d.ts, main.tsx, and settings hooks.
 */
export interface ResolvedFontConfig {
  mode: 'followEditor' | 'customFile';
  effectiveMode: 'followEditor' | 'customFile';
  customFontPath?: string;
  fontFamily: string;
  displayName?: string;
  fontSize: number;
  lineSpacing: number;
  fallbackFonts?: string[];
  fontUrl?: string;
  fontBase64?: string;
  fontFormat?: 'truetype' | 'opentype';
  warningCode?: 'fontUnavailable';
  warning?: string;
}

/** A UI font file from the local Claude desktop app (the host lists only files that exist). */
export interface UiFontPreset {
  id: 'claudeSans' | 'claudeSerif';
  /** English label; the settings page shows a translated label for the id */
  label: string;
  path: string;
}

/** Prefix of the UI font select value for a preset (for example "preset:claudeSans"). */
export const UI_FONT_PRESET_PREFIX = 'preset:';

export interface UiFontConfig extends ResolvedFontConfig {
  presets?: UiFontPreset[];
}

/** The preset whose file is the saved custom UI font, if any. */
export function findActiveUiFontPreset(config: UiFontConfig | undefined): UiFontPreset | undefined {
  if (!config || config.mode !== 'customFile' || !config.customFontPath) return undefined;
  return config.presets?.find((preset) => preset.path === config.customFontPath);
}

export interface CodeFontConfig extends ResolvedFontConfig {}
