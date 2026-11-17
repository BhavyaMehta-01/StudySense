import { render, screen, fireEvent, act } from '@testing-library/react';
import { describe, test, expect, beforeEach, vi } from 'vitest';
import { ThemeProvider, useTheme } from './useTheme';
import { ThemeToggle } from '@/components/ui/theme-toggle';

function TestConsumer() {
  const { theme, resolvedTheme, setTheme } = useTheme();
  return (
    <div>
      <span data-testid="theme-val">{theme}</span>
      <span data-testid="resolved-theme-val">{resolvedTheme}</span>
      <button onClick={() => setTheme('light')}>Set Light</button>
      <button onClick={() => setTheme('dark')}>Set Dark</button>
      <button onClick={() => setTheme('system')}>Set System</button>
    </div>
  );
}

describe('useTheme and ThemeProvider', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.className = '';
    vi.clearAllMocks();
  });

  test('provides default system theme and sets html class accordingly', () => {
    render(
      <ThemeProvider>
        <TestConsumer />
      </ThemeProvider>
    );

    expect(screen.getByTestId('theme-val').textContent).toBe('system');
    expect(screen.getByTestId('resolved-theme-val').textContent).toBe('light');
    expect(document.documentElement.classList.contains('dark')).toBe(false);
  });

  test('switches to dark theme and adds dark class to documentElement', () => {
    render(
      <ThemeProvider>
        <TestConsumer />
      </ThemeProvider>
    );

    act(() => {
      fireEvent.click(screen.getByText('Set Dark'));
    });

    expect(screen.getByTestId('theme-val').textContent).toBe('dark');
    expect(screen.getByTestId('resolved-theme-val').textContent).toBe('dark');
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(localStorage.getItem('studysense-theme')).toBe('dark');
  });

  test('switches to light theme and removes dark class from documentElement', () => {
    localStorage.setItem('studysense-theme', 'dark');

    render(
      <ThemeProvider>
        <TestConsumer />
      </ThemeProvider>
    );

    expect(screen.getByTestId('resolved-theme-val').textContent).toBe('dark');
    expect(document.documentElement.classList.contains('dark')).toBe(true);

    act(() => {
      fireEvent.click(screen.getByText('Set Light'));
    });

    expect(screen.getByTestId('theme-val').textContent).toBe('light');
    expect(screen.getByTestId('resolved-theme-val').textContent).toBe('light');
    expect(document.documentElement.classList.contains('dark')).toBe(false);
    expect(localStorage.getItem('studysense-theme')).toBe('light');
  });

  test('ThemeToggle toggles between light and dark modes', () => {
    render(
      <ThemeProvider>
        <ThemeToggle />
      </ThemeProvider>
    );

    const toggleBtn = screen.getByRole('button', { name: /switch to dark mode/i });
    expect(toggleBtn).toBeInTheDocument();
    expect(document.documentElement.classList.contains('dark')).toBe(false);

    act(() => {
      fireEvent.click(toggleBtn);
    });

    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(screen.getByRole('button', { name: /switch to light mode/i })).toBeInTheDocument();

    act(() => {
      fireEvent.click(screen.getByRole('button', { name: /switch to light mode/i }));
    });

    expect(document.documentElement.classList.contains('dark')).toBe(false);
  });
});
