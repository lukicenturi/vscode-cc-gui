import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { useSettingsBasicActions } from './useSettingsBasicActions';
import type { CommitAiConfig } from '../../../types/aiFeatureConfig';
import type { CodeFontConfig, UiFontConfig } from '../../../types/uiFontConfig';

describe('useSettingsBasicActions', () => {
  const defaultCommitAiConfig: CommitAiConfig = {
    provider: null,
    effectiveProvider: 'codex',
    resolutionSource: 'auto',
    models: {
      claude: 'claude-sonnet-4-6',
      codex: 'gpt-5.5',
    },
    availability: {
      claude: true,
      codex: true,
    },
  };

  beforeEach(() => {
    window.sendToJava = vi.fn();
  });

  it('updates commit AI provider without mutating prompt enhancer state', () => {
    const { result } = renderHook(() => useSettingsBasicActions({}));

    act(() => {
      result.current.setCommitAiConfig(defaultCommitAiConfig);
    });

    const promptEnhancerBefore = result.current.promptEnhancerConfig;

    act(() => {
      result.current.handleCommitAiProviderChange('claude');
    });

    expect(result.current.commitAiConfig.provider).toBe('claude');
    expect(result.current.promptEnhancerConfig).toEqual(promptEnhancerBefore);
    expect(window.sendToJava).toHaveBeenCalledWith(
      'set_commit_ai_config:{"provider":"claude","models":{"claude":"claude-sonnet-4-6","codex":"gpt-5.5"}}'
    );
  });

  it('updates commit AI model without mutating prompt enhancer models', () => {
    const { result } = renderHook(() => useSettingsBasicActions({}));

    act(() => {
      result.current.setCommitAiConfig({
        ...defaultCommitAiConfig,
        provider: 'codex',
        effectiveProvider: 'codex',
        resolutionSource: 'manual',
      });
    });

    const promptEnhancerBefore = result.current.promptEnhancerConfig;

    act(() => {
      result.current.handleCommitAiModelChange('gpt-5.4');
    });

    expect(result.current.commitAiConfig.models.codex).toBe('gpt-5.4');
    expect(result.current.promptEnhancerConfig).toEqual(promptEnhancerBefore);
    expect(window.sendToJava).toHaveBeenCalledWith(
      'set_commit_ai_config:{"provider":"codex","models":{"claude":"claude-sonnet-4-6","codex":"gpt-5.4"}}'
    );
  });

  it('sends independent code font updates without mutating ui font state', () => {
    const { result } = renderHook(() => useSettingsBasicActions({}));

    act(() => {
      result.current.handleCodeFontSelectionChange('followEditor');
    });

    expect(window.sendToJava).not.toHaveBeenCalledWith(
      'set_ui_font_config:{"mode":"customFile"}'
    );
    expect(window.sendToJava).toHaveBeenCalledWith(
      'set_code_font_config:{"mode":"followEditor"}'
    );
  });

  it('sends a code font customFile update when a saved path exists', () => {
    const { result } = renderHook(() => useSettingsBasicActions({}));

    const customCodeFontConfig: CodeFontConfig = {
      mode: 'customFile',
      effectiveMode: 'customFile',
      customFontPath: '/tmp/my-code-font.ttf',
      fontFamily: 'CC GUI Code Custom',
      fontSize: 13,
      lineSpacing: 1,
    };

    act(() => {
      result.current.setCodeFontConfig(customCodeFontConfig);
    });

    act(() => {
      result.current.handleCodeFontSelectionChange('customFile');
    });

    expect(window.sendToJava).toHaveBeenCalledWith(
      'set_code_font_config:{"mode":"customFile","customFontPath":"/tmp/my-code-font.ttf"}'
    );
  });

  it('does not send anything when switching to customFile without a saved path (silent no-op)', () => {
    const { result } = renderHook(() => useSettingsBasicActions({}));

    act(() => {
      result.current.handleCodeFontSelectionChange('customFile');
    });

    expect(window.sendToJava).not.toHaveBeenCalled();
  });

  it('saves a Claude app font preset as a custom UI font file', () => {
    const { result } = renderHook(() => useSettingsBasicActions({}));
    const presetPath = '/Applications/Claude.app/Contents/Resources/fonts/AnthropicSans-Romans-Variable-25x258.ttf';
    const uiFontConfig: UiFontConfig = {
      mode: 'followEditor',
      effectiveMode: 'followEditor',
      fontFamily: 'Inter',
      fontSize: 13,
      lineSpacing: 1.5,
      presets: [{ id: 'claudeSans', label: 'Claude app (Anthropic Sans)', path: presetPath }],
    };

    act(() => {
      result.current.setUiFontConfig(uiFontConfig);
    });
    act(() => {
      result.current.handleUiFontSelectionChange('preset:claudeSans');
    });
    act(() => {
      result.current.handleUiFontSelectionChange('preset:claudeSerif');
    });

    // The preset id always goes to the host, which resolves the file itself.
    // A known preset also carries its path; an unknown one sends an empty path.
    const setCalls = (window.sendToJava as ReturnType<typeof vi.fn>).mock.calls
      .map((call) => String(call[0]))
      .filter((message) => message.startsWith('set_ui_font_config:'));
    expect(setCalls).toEqual([
      `set_ui_font_config:${JSON.stringify({ mode: 'customFile', presetId: 'claudeSans', customFontPath: presetPath })}`,
      `set_ui_font_config:${JSON.stringify({ mode: 'customFile', presetId: 'claudeSerif', customFontPath: '' })}`,
    ]);
  });
});

