import { render, screen } from '@testing-library/react';
import { describe, test, expect } from 'vitest';
import { Button } from './button';

describe('Button component', () => {
  test('renders default variant with primary styling', () => {
    render(<Button>Click me</Button>);
    const button = screen.getByRole('button', { name: /click me/i });
    expect(button.className).toContain('bg-primary');
    expect(button.className).toContain('text-primary-foreground');
  });

  test('renders outline variant with theme-aware border and card background', () => {
    render(<Button variant="outline">Outline</Button>);
    const button = screen.getByRole('button', { name: /outline/i });
    expect(button.className).toContain('border-border');
    expect(button.className).toContain('bg-card');
    expect(button.className).toContain('text-foreground');
  });

  test('renders secondary variant with secondary styling and border', () => {
    render(<Button variant="secondary">Secondary</Button>);
    const button = screen.getByRole('button', { name: /secondary/i });
    expect(button.className).toContain('bg-secondary');
    expect(button.className).toContain('text-secondary-foreground');
    expect(button.className).toContain('border-border/50');
  });

  test('renders destructive variant with muted red styling', () => {
    render(<Button variant="destructive">Delete</Button>);
    const button = screen.getByRole('button', { name: /delete/i });
    expect(button.className).toContain('bg-destructive/10');
    expect(button.className).toContain('text-destructive');
    expect(button.className).toContain('border-destructive/30');
  });

  test('renders ghost variant with text-foreground and hover styling', () => {
    render(<Button variant="ghost">Ghost</Button>);
    const button = screen.getByRole('button', { name: /ghost/i });
    expect(button.className).toContain('text-foreground');
    expect(button.className).toContain('hover:bg-muted');
  });

  test('renders link variant with text-primary and hover underline', () => {
    render(<Button variant="link">Link</Button>);
    const button = screen.getByRole('button', { name: /link/i });
    expect(button.className).toContain('text-primary');
    expect(button.className).toContain('hover:underline');
  });

  test('disables button and applies disabled classes when disabled', () => {
    render(<Button disabled>Disabled</Button>);
    const button = screen.getByRole('button', { name: /disabled/i });
    expect(button).toBeDisabled();
    expect(button.className).toContain('disabled:opacity-50');
  });
});
