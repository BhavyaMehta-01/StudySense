import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { BrowserRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider } from '@/hooks/useAuth';
import Register from './Register';
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

test('shows validation errors for invalid register data', async () => {
  render(<Register />, { wrapper: Wrapper });
  
  fireEvent.click(screen.getByRole('button', { name: /create account/i }));
  
  await waitFor(() => {
    expect(screen.getByText(/name must be at least 2 characters/i)).not.toBeNull();
    expect(screen.getByText(/please enter a valid email address/i)).not.toBeNull();
    expect(screen.getByText(/password must be at least 8 characters/i)).not.toBeNull();
  });
});

test('submits successfully on valid data', async () => {
  (api.post as any).mockResolvedValueOnce({});
  
  render(<Register />, { wrapper: Wrapper });
  
  fireEvent.change(screen.getByLabelText(/full name/i), { target: { value: 'John Doe' } });
  fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'john@example.com' } });
  fireEvent.change(screen.getByLabelText(/password/i), { target: { value: 'password123' } });
  
  fireEvent.click(screen.getByRole('button', { name: /create account/i }));
  
  await waitFor(() => {
    expect(api.post).toHaveBeenCalledWith('/auth/register', {
      name: 'John Doe',
      email: 'john@example.com',
      password: 'password123'
    });
    expect(screen.getByText(/account created successfully/i)).not.toBeNull();
  });
});
