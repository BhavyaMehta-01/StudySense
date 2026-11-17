import { useState, useEffect, useRef } from 'react';
import { Outlet, Navigate, Link, useLocation } from 'react-router';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { ThemeToggle } from '@/components/ui/theme-toggle';
import { LogOut, Menu, X, LayoutDashboard, GraduationCap, FileSpreadsheet, Settings } from 'lucide-react';
import { cn } from '@/lib/utils';

const NAV_ITEMS = [
  { name: 'Dashboard', path: '/app/dashboard', icon: LayoutDashboard },
  { name: 'Semesters', path: '/app/semesters', icon: GraduationCap },
  { name: 'Import CSV', path: '/app/import', icon: FileSpreadsheet },
  { name: 'Settings', path: '/app/settings', icon: Settings },
];

export default function AppLayout() {
  const { user, isLoading, logout } = useAuth();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const location = useLocation();
  const mobileMenuRef = useRef<HTMLDivElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!isMobileMenuOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsMobileMenuOpen(false);
    };

    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node | null;
      if (!target) return;

      const path = typeof e.composedPath === 'function' ? e.composedPath() : [];
      const isMenuButton = Boolean(
        menuButtonRef.current && (
          path.includes(menuButtonRef.current) ||
          menuButtonRef.current.contains(target)
        )
      );
      const isInsideMenu = Boolean(
        mobileMenuRef.current && (
          path.includes(mobileMenuRef.current) ||
          mobileMenuRef.current.contains(target)
        )
      );

      if (isMenuButton || isInsideMenu) {
        return;
      }

      setIsMobileMenuOpen(false);
    };

    window.addEventListener('keydown', handleKeyDown);
    document.addEventListener('click', handleClickOutside);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('click', handleClickOutside);
    };
  }, [isMobileMenuOpen]);

  if (isLoading) {
    return <div className="flex h-screen items-center justify-center">Loading...</div>;
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  return (
    <div className="relative min-h-screen bg-background text-foreground transition-colors overflow-x-hidden">
      {/* Ambient background decoration layers */}
      <div className="pointer-events-none fixed inset-0 z-0 overflow-hidden" aria-hidden="true">
        {/* Soft radial Indigo glow near the top-center */}
        <div className="absolute -top-36 left-1/2 -translate-x-1/2 w-[900px] h-[450px] rounded-full bg-primary/10 dark:bg-primary/15 blur-[130px]" />
        {/* Subtle Cyan ambient accent in bottom-right */}
        <div className="absolute -bottom-48 -right-48 w-[600px] h-[600px] rounded-full bg-brand-secondary/6 dark:bg-brand-secondary/10 blur-[140px]" />
        {/* Micro engineering dot-grid texture */}
        <div className="absolute inset-0 bg-[radial-gradient(var(--border)_1px,transparent_1px)] [background-size:24px_24px] opacity-35 dark:opacity-20 [mask-image:radial-gradient(ellipse_at_center,black_40%,transparent_80%)]" />
      </div>

      {/* Backdrop overlay when mobile menu is open */}
      {isMobileMenuOpen && (
        <div
          className="fixed inset-0 z-10 bg-background/60 backdrop-blur-xs md:hidden"
          onClick={() => setIsMobileMenuOpen(false)}
          aria-hidden="true"
        />
      )}

      <div className="relative z-10 flex min-h-screen flex-col">
        <header className="sticky top-0 z-20 bg-card/80 backdrop-blur-md border-b border-border shadow-xs">
          <div className="mx-auto flex max-w-7xl items-center justify-between px-3 sm:px-6 lg:px-8">
            <div className="flex items-center gap-2 sm:gap-6 shrink-0">
              <Button
                ref={menuButtonRef}
                variant="ghost"
                size="sm"
                onClick={(e) => {
                  e.stopPropagation();
                  setIsMobileMenuOpen((prev) => !prev);
                }}
                className="md:hidden h-8 w-8 px-0 text-muted-foreground hover:text-foreground shrink-0"
                aria-label={isMobileMenuOpen ? "Close navigation menu" : "Open navigation menu"}
                aria-expanded={isMobileMenuOpen}
                aria-controls="mobile-navigation-menu"
              >
                {isMobileMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
              </Button>
              <Link to="/app/dashboard" className="text-lg sm:text-xl font-bold tracking-tight text-foreground hover:opacity-90 transition-opacity">
                StudySense
              </Link>
              <nav className="hidden md:flex gap-4">
                <Link to="/app/dashboard" className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors">
                  Dashboard
                </Link>
                <Link to="/app/semesters" className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors">
                  Semesters
                </Link>
                <Link to="/app/import" className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors">
                  Import CSV
                </Link>
              </nav>
            </div>
            <div className="flex items-center gap-1.5 sm:gap-3 min-w-0 justify-end">
              <span
                className="text-xs sm:text-sm text-muted-foreground truncate max-w-[120px] min-[400px]:max-w-[160px] sm:max-w-none whitespace-nowrap text-right"
                title={`Welcome, ${user.name}`}
              >
                <span className="hidden sm:inline">Welcome, {user.name}</span>
                <span className="sm:hidden">{user.name}</span>
              </span>
              <Link to="/app/settings" className="text-sm text-muted-foreground hover:text-foreground font-medium hidden sm:inline transition-colors">
                Settings
              </Link>
              <span className="text-sm text-border hidden sm:inline">|</span>
              <ThemeToggle className="h-8 w-8 px-0 shrink-0" />
              <Button
                variant="ghost"
                size="sm"
                onClick={logout}
                className="h-8 w-8 px-0 sm:w-auto sm:px-3 gap-2 text-muted-foreground hover:text-foreground shrink-0"
                aria-label="Log out"
                title="Log out"
              >
                <LogOut className="h-4 w-4" />
                <span className="hidden sm:inline">Logout</span>
              </Button>
            </div>
          </div>

          {/* Mobile Navigation Dropdown */}
          {isMobileMenuOpen && (
            <div
              ref={mobileMenuRef}
              id="mobile-navigation-menu"
              className="md:hidden border-t border-border bg-card/95 backdrop-blur-md px-4 py-3 shadow-md"
            >
              <nav className="flex flex-col space-y-1" aria-label="Mobile navigation">
                {NAV_ITEMS.map((item) => {
                  const isActive = location.pathname.startsWith(item.path);
                  return (
                    <Link
                      key={item.path}
                      to={item.path}
                      onClick={() => setIsMobileMenuOpen(false)}
                      className={cn(
                        "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors",
                        isActive
                          ? "bg-primary/10 text-primary font-semibold"
                          : "text-muted-foreground hover:bg-muted hover:text-foreground"
                      )}
                      aria-current={isActive ? "page" : undefined}
                    >
                      <item.icon className="h-4 w-4 shrink-0" />
                      <span>{item.name}</span>
                    </Link>
                  );
                })}
              </nav>
            </div>
          )}
        </header>

        <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-8 sm:px-6 lg:px-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
