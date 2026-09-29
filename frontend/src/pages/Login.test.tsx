import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { BrowserRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider } from '@/hooks/useAuth';
import Login from './Login';
import { expect, test, vi } from 'vitest';
import { api } from '@/api/client';

vi.mock('@/api/client', () => ({
  api: {
    post: vi.fn(),
    get: vi.fn(),
  }
}));

const queryClient = new QueryClient();

const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <QueryClientProvider client={queryClient}>
    <BrowserRouter>
      <AuthProvider>
        {children}
      </AuthProvider>
    </BrowserRouter>
  </QueryClientProvider>
);

test('shows validation errors on empty submission', async () => {
  render(<Login />, { wrapper: Wrapper });
  
  fireEvent.click(screen.getByRole('button', { name: /sign in/i }));
  
  await waitFor(() => {
    expect(screen.getByText(/please enter a valid email address/i)).not.toBeNull();
    expect(screen.getByText(/password is required/i)).not.toBeNull();
  });
});

test('calls api on valid submission', async () => {
  (api.post as any).mockResolvedValueOnce({ access_token: 'fake-token' });
  (api.get as any).mockResolvedValueOnce({ id: '1', email: 'test@test.com', name: 'Test' });
  
  render(<Login />, { wrapper: Wrapper });
  
  fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'test@example.com' } });
  fireEvent.change(screen.getByLabelText(/password/i), { target: { value: 'password123' } });
  
  fireEvent.click(screen.getByRole('button', { name: /sign in/i }));
  
  await waitFor(() => {
    expect(api.post).toHaveBeenCalledWith('/auth/login', {
      email: 'test@example.com',
      password: 'password123'
    });
  });
});
