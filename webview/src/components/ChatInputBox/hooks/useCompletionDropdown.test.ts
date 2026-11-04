import { act, renderHook } from '@testing-library/react';
import { useCompletionDropdown } from './useCompletionDropdown.js';
import type { DropdownItemData, TriggerQuery } from '../types.js';

interface Item {
  name: string;
}

const items: Item[] = [{ name: 'alpha.ts' }, { name: 'beta.ts' }];
const position = { top: 0, left: 0, width: 100, height: 20 };

function query(start: number, text = ''): TriggerQuery {
  return { trigger: '@', query: text, start, end: start + 1 + text.length };
}

function key(name: string, mods: { shiftKey?: boolean } = {}): KeyboardEvent {
  return { key: name, shiftKey: false, preventDefault: vi.fn(), ...mods } as unknown as KeyboardEvent;
}

function setup() {
  const onSelect = vi.fn();
  const provider = vi.fn(async () => items);
  const hook = renderHook(() =>
    useCompletionDropdown<Item>({
      trigger: '@',
      provider,
      toDropdownItem: (item): DropdownItemData =>
        ({ id: item.name, label: item.name, type: 'item' }) as unknown as DropdownItemData,
      onSelect,
      debounceMs: 0,
    })
  );
  return { hook, onSelect, provider };
}

/** Open the dropdown for a trigger and let the search finish. */
async function openAndSearch(hook: ReturnType<typeof setup>['hook'], triggerQuery: TriggerQuery) {
  await act(async () => {
    hook.result.current.open(position, triggerQuery);
    hook.result.current.updateQuery(triggerQuery);
  });
  await act(async () => {
    vi.runAllTimers();
    await Promise.resolve();
  });
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('useCompletionDropdown: dismiss keys', () => {
  it('Enter selects the active item', async () => {
    const { hook, onSelect } = setup();
    await openAndSearch(hook, query(0));
    expect(hook.result.current.items).toHaveLength(2);

    let handled = false;
    await act(async () => {
      handled = hook.result.current.handleKeyDown(key('Enter'));
    });

    expect(handled).toBe(true);
    expect(onSelect).toHaveBeenCalledWith(items[0], query(0));
    expect(hook.result.current.isOpen).toBe(false);
  });

  it('Tab without arrow keys dismisses the dropdown and selects nothing', async () => {
    const { hook, onSelect } = setup();
    await openAndSearch(hook, query(0));

    const event = key('Tab');
    let handled = false;
    await act(async () => {
      handled = hook.result.current.handleKeyDown(event);
    });

    expect(handled).toBe(true);
    expect(event.preventDefault).toHaveBeenCalled();
    expect(onSelect).not.toHaveBeenCalled();
    expect(hook.result.current.isOpen).toBe(false);
  });

  it('Tab after ArrowDown selects the active item', async () => {
    const { hook, onSelect } = setup();
    await openAndSearch(hook, query(0));

    await act(async () => {
      hook.result.current.handleKeyDown(key('ArrowDown'));
    });
    await act(async () => {
      hook.result.current.handleKeyDown(key('Tab'));
    });

    expect(onSelect).toHaveBeenCalledWith(items[1], query(0));
    expect(hook.result.current.isOpen).toBe(false);
  });

  it('Shift+Enter dismisses the dropdown and is not handled, so the input gets a new line', async () => {
    const { hook, onSelect } = setup();
    await openAndSearch(hook, query(0));

    const event = key('Enter', { shiftKey: true });
    let handled = true;
    await act(async () => {
      handled = hook.result.current.handleKeyDown(event);
    });

    expect(handled).toBe(false);
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(onSelect).not.toHaveBeenCalled();
    expect(hook.result.current.isOpen).toBe(false);
  });

  it('Escape dismisses the dropdown', async () => {
    const { hook } = setup();
    await openAndSearch(hook, query(0));

    await act(async () => {
      hook.result.current.handleKeyDown(key('Escape'));
    });

    expect(hook.result.current.isOpen).toBe(false);
  });
});

describe('useCompletionDropdown: dismissed trigger', () => {
  it('does not open again for the same trigger while the user types on', async () => {
    const { hook, provider } = setup();
    await openAndSearch(hook, query(5, 'ex'));
    await act(async () => {
      hook.result.current.handleKeyDown(key('Tab'));
    });
    provider.mockClear();

    // The user types more of the word: same @ at offset 5, longer query
    await openAndSearch(hook, query(5, 'example'));

    expect(hook.result.current.isOpen).toBe(false);
    expect(provider).not.toHaveBeenCalled();
  });

  it('opens for a trigger with a different start', async () => {
    const { hook } = setup();
    await openAndSearch(hook, query(5, 'ex'));
    await act(async () => {
      hook.result.current.handleKeyDown(key('Tab'));
    });

    await openAndSearch(hook, query(20));

    expect(hook.result.current.isOpen).toBe(true);
  });

  it('opens again for the same start after close(): the trigger went away', async () => {
    const { hook } = setup();
    await openAndSearch(hook, query(5, 'ex'));
    await act(async () => {
      hook.result.current.handleKeyDown(key('Escape'));
    });

    // The trigger detection calls close() when the text has no trigger
    await act(async () => {
      hook.result.current.close();
    });
    await openAndSearch(hook, query(5));

    expect(hook.result.current.isOpen).toBe(true);
  });

  it('a new open() resets the arrow key memory, so Tab dismisses again', async () => {
    const { hook, onSelect } = setup();
    await openAndSearch(hook, query(0));
    await act(async () => {
      hook.result.current.handleKeyDown(key('ArrowDown'));
    });
    await act(async () => {
      hook.result.current.handleKeyDown(key('Escape'));
    });

    await openAndSearch(hook, query(10));
    await act(async () => {
      hook.result.current.handleKeyDown(key('Tab'));
    });

    expect(onSelect).not.toHaveBeenCalled();
    expect(hook.result.current.isOpen).toBe(false);
  });
});
