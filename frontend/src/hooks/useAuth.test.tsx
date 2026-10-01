import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, test, expect, vi, beforeEach } from 'vitest';
import { BrowserRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider, useAuth } from './useAuth';
import { api } from '@/api/client';

vi.mock('@/api/client', () => ({
  api: {
    get: vi.fn(),
  }
}));

const mockNavigate = vi.fn();
vi.mock('react-router', async () => {
  const actual = await vi.importActual('react-router');
  return {
    ...actual as any,
    useNavigate: () => mockNavigate,
  };
});

describe('useAuth cache isolation', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
  });

  const TestComponent = () => {
    const { logout, login } = useAuth();
    
    return (
      <div>
        <button onClick={() => login('dummy-token')}>Login</button>
        <button onClick={() => logout()}>Logout</button>
        <button onClick={() => {
          // manually trigger unauthorized event
          window.dispatchEvent(new Event('auth-unauthorized'));
        }}>Trigger Unauthorized</button>
      </div>
    );
  };

  const Wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AuthProvider>
          {children}
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  );

  test('logout clears QueryClient cache', async () => {
    (api.get as any).mockResolvedValue({ id: '1', email: 'test@example.com', name: 'Test User' });
    
    render(<TestComponent />, { wrapper: Wrapper });
    
    // Simulate user having cached data
    queryClient.setQueryData(['dashboard'], { someData: true });
    expect(queryClient.getQueryData(['dashboard'])).toBeDefined();

    // Perform login (which sets token)
    fireEvent.click(screen.getByText('Login'));
    await waitFor(() => {
      expect(localStorage.getItem('token')).toBe('dummy-token');
    });

    // Perform logout
    fireEvent.click(screen.getByText('Logout'));
    
    await waitFor(() => {
      // 1. Auth token cleared
      expect(localStorage.getItem('token')).toBeNull();
      
      // 2. QueryClient cache completely cleared
      expect(queryClient.getQueryData(['dashboard'])).toBeUndefined();
      
      // 3. Navigation occurred
      expect(mockNavigate).toHaveBeenCalledWith('/login');
    });
  });

  test('auth-unauthorized event clears QueryClient cache', async () => {
    (api.get as any).mockResolvedValue({ id: '1', email: 'test@example.com', name: 'Test User' });
    
    render(<TestComponent />, { wrapper: Wrapper });
    
    // Simulate cached data
    queryClient.setQueryData(['semesters'], { someData: true });
    expect(queryClient.getQueryData(['semesters'])).toBeDefined();

    // Trigger unauthorized event
    fireEvent.click(screen.getByText('Trigger Unauthorized'));
    
    await waitFor(() => {
      // Cache cleared
      expect(queryClient.getQueryData(['semesters'])).toBeUndefined();
      expect(mockNavigate).toHaveBeenCalledWith('/login');
    });
  });
});
