import { fireEvent, render, screen } from '@testing-library/react';
import type { TFunction } from 'i18next';
import { describe, expect, it, vi } from 'vitest';

import { ChatHeader, type ChatHeaderProps } from './ChatHeader';

const t = ((key: string) => key) as unknown as TFunction;

function renderHeader(overrides: Partial<ChatHeaderProps> = {}) {
  const props: ChatHeaderProps = {
    currentView: 'chat',
    sessionTitle: 'Session',
    t,
    onBack: vi.fn(),
    onNewSession: vi.fn(),
    onNewTab: vi.fn(),
    onHistory: vi.fn(),
    onSettings: vi.fn(),
    ...overrides,
  };
  return render(<ChatHeader {...props} />);
}

describe('ChatHeader remote control button', () => {
  it('renders the button and calls the handler on click', () => {
    const onRemoteControl = vi.fn();
    renderHeader({ onRemoteControl });

    const button = screen.getByRole('button', { name: 'common.remoteControl' });
    expect(button.getAttribute('data-tooltip')).toBe('common.remoteControl');
    expect(button.querySelector('.codicon-device-mobile')).not.toBeNull();

    fireEvent.click(button);
    expect(onRemoteControl).toHaveBeenCalledTimes(1);
  });

  it('does not render the button when the handler is not provided', () => {
    renderHeader();

    expect(screen.queryByRole('button', { name: 'common.remoteControl' })).toBeNull();
  });

  it('does not render the button outside the chat view', () => {
    renderHeader({ currentView: 'settings', onRemoteControl: vi.fn() });

    expect(screen.queryByRole('button', { name: 'common.remoteControl' })).toBeNull();
  });
});
