import { render, screen, fireEvent } from '@testing-library/react';
import { describe, test, expect, vi } from 'vitest';
import { MemoryRouter, Routes, Route } from 'react-router';
import AppLayout from './AppLayout';
import { useAuth } from '@/hooks/useAuth';
import { ThemeProvider } from '@/hooks/useTheme';

vi.mock('@/hooks/useAuth', () => ({
  useAuth: vi.fn(),
}));

describe('AppLayout Layout and Background Glow', () => {
  test('redirects unauthenticated users to /login', () => {
    (useAuth as any).mockReturnValue({
      user: null,
      isLoading: false,
      logout: vi.fn(),
    });

    render(
      <MemoryRouter initialEntries={['/app/dashboard']}>
        <Routes>
          <Route path="/app" element={<AppLayout />}>
            <Route path="dashboard" element={<div>Dashboard Content</div>} />
          </Route>
          <Route path="/login" element={<div>Login Page</div>} />
        </Routes>
      </MemoryRouter>
    );

    expect(screen.getByText('Login Page')).toBeInTheDocument();
  });

  test('renders navigation and ambient background layers for authenticated users', () => {
    (useAuth as any).mockReturnValue({
      user: { id: 'u1', name: 'Alex Student', email: 'alex@example.com' },
      isLoading: false,
      logout: vi.fn(),
    });

    const { container } = render(
      <MemoryRouter initialEntries={['/app/dashboard']}>
        <Routes>
          <Route path="/app" element={<AppLayout />}>
            <Route path="dashboard" element={<div>Dashboard Content</div>} />
          </Route>
        </Routes>
      </MemoryRouter>
    );

    expect(screen.getByText('Welcome, Alex Student')).toBeInTheDocument();
    expect(screen.getByText('Dashboard Content')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Semesters' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Import CSV' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Settings' })).toBeInTheDocument();

    // Verify ambient decoration layer has aria-hidden and pointer-events-none
    const ambientLayer = container.querySelector('[aria-hidden="true"]');
    expect(ambientLayer).toBeInTheDocument();
    expect(ambientLayer?.className).toContain('pointer-events-none');
    expect(ambientLayer?.className).toContain('fixed');
  });

  test('renders responsive compact greeting and accessible controls for mobile screens', () => {
    const logoutMock = vi.fn();
    (useAuth as any).mockReturnValue({
      user: { id: 'u1', name: 'Test Student', email: 'test@example.com' },
      isLoading: false,
      logout: logoutMock,
    });

    render(
      <MemoryRouter initialEntries={['/app/dashboard']}>
        <Routes>
          <Route path="/app" element={<AppLayout />}>
            <Route path="dashboard" element={<div>Dashboard Content</div>} />
          </Route>
        </Routes>
      </MemoryRouter>
    );

    // Left branding
    const brandLink = screen.getByRole('link', { name: 'StudySense' });
    expect(brandLink).toBeInTheDocument();
    expect(brandLink.parentElement?.className).toContain('shrink-0');

    // Desktop greeting has hidden sm:inline
    const desktopGreeting = screen.getByText('Welcome, Test Student');
    expect(desktopGreeting).toBeInTheDocument();
    expect(desktopGreeting.className).toContain('hidden sm:inline');

    // Mobile greeting has sm:hidden
    const mobileGreeting = screen.getByText('Test Student');
    expect(mobileGreeting).toBeInTheDocument();
    expect(mobileGreeting.className).toContain('sm:hidden');

    // Greeting wrapper prevents awkward multiline wrapping
    const greetingWrapper = desktopGreeting.parentElement;
    expect(greetingWrapper?.className).toContain('whitespace-nowrap');
    expect(greetingWrapper?.className).toContain('truncate');
    expect(greetingWrapper?.className).toContain('text-xs');

    // Controls remain accessible
    const themeToggle = screen.getByRole('button', { name: /switch to/i });
    expect(themeToggle).toBeInTheDocument();
    expect(themeToggle.className).toContain('shrink-0');

    const logoutBtn = screen.getByRole('button', { name: /log out/i });
    expect(logoutBtn).toBeInTheDocument();
    expect(logoutBtn.className).toContain('shrink-0');
  });

  describe('Mobile Navigation Menu', () => {
    test('opens and closes mobile navigation menu via hamburger toggle and shows all 4 destinations', async () => {
      (useAuth as any).mockReturnValue({
        user: { id: 'u1', name: 'Test Student', email: 'test@example.com' },
        isLoading: false,
        logout: vi.fn(),
      });

      render(
        <MemoryRouter initialEntries={['/app/dashboard']}>
          <Routes>
            <Route path="/app" element={<AppLayout />}>
              <Route path="dashboard" element={<div>Dashboard Content</div>} />
              <Route path="semesters" element={<div>Semesters Content</div>} />
              <Route path="import" element={<div>Import Content</div>} />
              <Route path="settings" element={<div>Settings Content</div>} />
            </Route>
          </Routes>
        </MemoryRouter>
      );

      const menuToggle = screen.getByRole('button', { name: /open navigation menu/i });
      expect(menuToggle).toHaveAttribute('aria-expanded', 'false');
      expect(menuToggle).toHaveAttribute('aria-controls', 'mobile-navigation-menu');
      expect(screen.queryByLabelText('Mobile navigation')).not.toBeInTheDocument();

      // Open menu
      fireEvent.click(menuToggle);

      expect(menuToggle).toHaveAttribute('aria-expanded', 'true');
      expect(menuToggle).toHaveAttribute('aria-label', 'Close navigation menu');

      const mobileNav = screen.getByLabelText('Mobile navigation');
      expect(mobileNav).toBeInTheDocument();

      // Verify all 4 primary destinations are present in mobile nav
      const mobileLinks = mobileNav.querySelectorAll('a');
      expect(mobileLinks.length).toBe(4);
      expect(mobileLinks[0]).toHaveTextContent('Dashboard');
      expect(mobileLinks[0]).toHaveAttribute('href', '/app/dashboard');
      expect(mobileLinks[1]).toHaveTextContent('Semesters');
      expect(mobileLinks[1]).toHaveAttribute('href', '/app/semesters');
      expect(mobileLinks[2]).toHaveTextContent('Import CSV');
      expect(mobileLinks[2]).toHaveAttribute('href', '/app/import');
      expect(mobileLinks[3]).toHaveTextContent('Settings');
      expect(mobileLinks[3]).toHaveAttribute('href', '/app/settings');

      // Close menu
      fireEvent.click(menuToggle);

      expect(menuToggle).toHaveAttribute('aria-expanded', 'false');
      expect(screen.queryByLabelText('Mobile navigation')).not.toBeInTheDocument();
    });

    test('opens and closes mobile navigation menu when clicking inner icon of hamburger button', () => {
      (useAuth as any).mockReturnValue({
        user: { id: 'u1', name: 'Test Student', email: 'test@example.com' },
        isLoading: false,
        logout: vi.fn(),
      });

      render(
        <MemoryRouter initialEntries={['/app/dashboard']}>
          <Routes>
            <Route path="/app" element={<AppLayout />}>
              <Route path="dashboard" element={<div>Dashboard Content</div>} />
            </Route>
          </Routes>
        </MemoryRouter>
      );

      const menuToggle = screen.getByRole('button', { name: /open navigation menu/i });
      const menuIcon = menuToggle.querySelector('svg');
      expect(menuIcon).toBeInTheDocument();

      // Click directly on the SVG icon (simulates real browser click on the icon)
      fireEvent.click(menuIcon!);
      expect(screen.getByLabelText('Mobile navigation')).toBeInTheDocument();
      expect(menuToggle).toHaveAttribute('aria-expanded', 'true');

      // Click the close (X) icon to close
      const closeIcon = menuToggle.querySelector('svg');
      expect(closeIcon).toBeInTheDocument();
      fireEvent.click(closeIcon!);
      expect(screen.queryByLabelText('Mobile navigation')).not.toBeInTheDocument();
      expect(menuToggle).toHaveAttribute('aria-expanded', 'false');
    });

    test('highlights the active page in mobile navigation menu', () => {
      (useAuth as any).mockReturnValue({
        user: { id: 'u1', name: 'Test Student', email: 'test@example.com' },
        isLoading: false,
        logout: vi.fn(),
      });

      render(
        <MemoryRouter initialEntries={['/app/semesters']}>
          <Routes>
            <Route path="/app" element={<AppLayout />}>
              <Route path="semesters" element={<div>Semesters Content</div>} />
            </Route>
          </Routes>
        </MemoryRouter>
      );

      // Open menu
      fireEvent.click(screen.getByRole('button', { name: /open navigation menu/i }));

      const mobileNav = screen.getByLabelText('Mobile navigation');
      const semestersLink = screen.getByRole('link', { name: /semesters/i, current: 'page' });
      expect(semestersLink).toBeInTheDocument();
      expect(semestersLink.className).toContain('text-primary');
      expect(semestersLink.className).toContain('font-semibold');

      // Other links should not have aria-current="page"
      const allMobileLinks = Array.from(mobileNav.querySelectorAll('a'));
      const nonActiveLinks = allMobileLinks.filter(l => l !== semestersLink);
      nonActiveLinks.forEach(link => {
        expect(link).not.toHaveAttribute('aria-current', 'page');
        expect(link.className).toContain('text-muted-foreground');
      });
    });

    test('closes mobile menu when link is clicked, Escape key is pressed, or backdrop is clicked', () => {
      (useAuth as any).mockReturnValue({
        user: { id: 'u1', name: 'Test Student', email: 'test@example.com' },
        isLoading: false,
        logout: vi.fn(),
      });

      const { container } = render(
        <MemoryRouter initialEntries={['/app/dashboard']}>
          <Routes>
            <Route path="/app" element={<AppLayout />}>
              <Route path="dashboard" element={<div>Dashboard Content</div>} />
              <Route path="semesters" element={<div>Semesters Content</div>} />
            </Route>
          </Routes>
        </MemoryRouter>
      );

      const menuToggle = screen.getByRole('button', { name: /open navigation menu/i });

      // 1. Close on Escape
      fireEvent.click(menuToggle);
      expect(screen.getByLabelText('Mobile navigation')).toBeInTheDocument();

      fireEvent.keyDown(window, { key: 'Escape' });
      expect(screen.queryByLabelText('Mobile navigation')).not.toBeInTheDocument();

      // 2. Close on backdrop click
      fireEvent.click(menuToggle);
      expect(screen.getByLabelText('Mobile navigation')).toBeInTheDocument();

      const backdrop = container.querySelector('[aria-hidden="true"].fixed.inset-0.z-10');
      expect(backdrop).toBeInTheDocument();
      fireEvent.click(backdrop as HTMLElement);
      expect(screen.queryByLabelText('Mobile navigation')).not.toBeInTheDocument();

      // 3. Close on link navigation click
      fireEvent.click(menuToggle);
      const mobileNav = screen.getByLabelText('Mobile navigation');
      const semestersLink = mobileNav.querySelector('a[href="/app/semesters"]');
      expect(semestersLink).toBeInTheDocument();
      fireEvent.click(semestersLink as HTMLElement);
      expect(screen.queryByLabelText('Mobile navigation')).not.toBeInTheDocument();
    });

    test('closes mobile menu when clicking outside controls like Appearance (ThemeToggle) while preserving its action', () => {
      (useAuth as any).mockReturnValue({
        user: { id: 'u1', name: 'Test Student', email: 'test@example.com' },
        isLoading: false,
        logout: vi.fn(),
      });

      render(
        <ThemeProvider>
          <MemoryRouter initialEntries={['/app/dashboard']}>
            <Routes>
              <Route path="/app" element={<AppLayout />}>
                <Route path="dashboard" element={<div>Dashboard Content</div>} />
              </Route>
            </Routes>
          </MemoryRouter>
        </ThemeProvider>
      );

      const menuToggle = screen.getByRole('button', { name: /open navigation menu/i });
      fireEvent.click(menuToggle);
      expect(screen.getByLabelText('Mobile navigation')).toBeInTheDocument();

      const themeToggle = screen.getByRole('button', { name: /switch to (dark|light) mode/i });
      expect(themeToggle).toBeInTheDocument();
      const initialLabel = themeToggle.getAttribute('aria-label');

      // Click ThemeToggle outside the mobile menu dropdown
      fireEvent.click(themeToggle);

      // 1. Mobile menu must close
      expect(screen.queryByLabelText('Mobile navigation')).not.toBeInTheDocument();

      // 2. ThemeToggle normal action must execute
      const updatedLabel = themeToggle.getAttribute('aria-label');
      expect(updatedLabel).not.toBe(initialLabel);
    });

    test('does not close mobile menu when clicking inside the navigation container', () => {
      (useAuth as any).mockReturnValue({
        user: { id: 'u1', name: 'Test Student', email: 'test@example.com' },
        isLoading: false,
        logout: vi.fn(),
      });

      render(
        <MemoryRouter initialEntries={['/app/dashboard']}>
          <Routes>
            <Route path="/app" element={<AppLayout />}>
              <Route path="dashboard" element={<div>Dashboard Content</div>} />
            </Route>
          </Routes>
        </MemoryRouter>
      );

      const menuToggle = screen.getByRole('button', { name: /open navigation menu/i });
      fireEvent.click(menuToggle);

      const mobileNav = screen.getByLabelText('Mobile navigation');
      expect(mobileNav).toBeInTheDocument();

      // Click container itself (not a navigation link)
      fireEvent.click(mobileNav);

      // Menu must remain open
      expect(screen.getByLabelText('Mobile navigation')).toBeInTheDocument();
    });

    test('closes mobile menu when clicking other header controls like Logout while executing logout', () => {
      const logoutMock = vi.fn();
      (useAuth as any).mockReturnValue({
        user: { id: 'u1', name: 'Test Student', email: 'test@example.com' },
        isLoading: false,
        logout: logoutMock,
      });

      render(
        <MemoryRouter initialEntries={['/app/dashboard']}>
          <Routes>
            <Route path="/app" element={<AppLayout />}>
              <Route path="dashboard" element={<div>Dashboard Content</div>} />
            </Route>
          </Routes>
        </MemoryRouter>
      );

      fireEvent.click(screen.getByRole('button', { name: /open navigation menu/i }));
      expect(screen.getByLabelText('Mobile navigation')).toBeInTheDocument();

      const logoutBtn = screen.getByRole('button', { name: /log out/i });
      fireEvent.click(logoutBtn);

      // Menu closes and logout action is executed
      expect(screen.queryByLabelText('Mobile navigation')).not.toBeInTheDocument();
      expect(logoutMock).toHaveBeenCalledTimes(1);
    });

    test('supports sequential hamburger open, close, and outside dismiss cycles smoothly', () => {
      const logoutMock = vi.fn();
      (useAuth as any).mockReturnValue({
        user: { id: 'u1', name: 'Test Student', email: 'test@example.com' },
        isLoading: false,
        logout: logoutMock,
      });

      render(
        <ThemeProvider>
          <MemoryRouter initialEntries={['/app/dashboard']}>
            <Routes>
              <Route path="/app" element={<AppLayout />}>
                <Route path="dashboard" element={<div>Dashboard Content</div>} />
              </Route>
            </Routes>
          </MemoryRouter>
        </ThemeProvider>
      );

      const menuToggle = screen.getByRole('button', { name: /open navigation menu/i });

      // Cycle 1: Open with hamburger -> close with hamburger
      fireEvent.click(menuToggle);
      expect(screen.getByLabelText('Mobile navigation')).toBeInTheDocument();
      fireEvent.click(menuToggle);
      expect(screen.queryByLabelText('Mobile navigation')).not.toBeInTheDocument();

      // Cycle 2: Open with hamburger -> dismiss via ThemeToggle
      fireEvent.click(menuToggle);
      expect(screen.getByLabelText('Mobile navigation')).toBeInTheDocument();
      const themeToggle = screen.getByRole('button', { name: /switch to (dark|light) mode/i });
      fireEvent.click(themeToggle);
      expect(screen.queryByLabelText('Mobile navigation')).not.toBeInTheDocument();

      // Cycle 3: Open with hamburger icon click -> close with hamburger icon click
      const menuIcon = menuToggle.querySelector('svg');
      fireEvent.click(menuIcon!);
      expect(screen.getByLabelText('Mobile navigation')).toBeInTheDocument();
      const closeIcon = menuToggle.querySelector('svg');
      fireEvent.click(closeIcon!);
      expect(screen.queryByLabelText('Mobile navigation')).not.toBeInTheDocument();
    });
  });
});
