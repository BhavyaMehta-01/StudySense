import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, test, expect, vi, beforeEach } from 'vitest';
import { BrowserRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import Semesters from './Semesters';
import { api } from '@/api/client';

// Mock API client
vi.mock('@/api/client', () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    delete: vi.fn(),
  }
}));

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false } },
});

const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <QueryClientProvider client={queryClient}>
    <BrowserRouter>{children}</BrowserRouter>
  </QueryClientProvider>
);

describe('Semesters', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queryClient.clear();
  });

  test('renders empty state when no semesters', async () => {
    (api.get as any).mockResolvedValue([]);
    
    render(<Semesters />, { wrapper: Wrapper });
    
    expect(screen.getByText(/loading semesters/i)).not.toBeNull();
    
    await waitFor(() => {
      expect(screen.getByText(/no semesters/i)).not.toBeNull();
    });
  });

  test('renders list of semesters', async () => {
    (api.get as any).mockResolvedValue([
      { id: '1', name: 'Fall 2026', academic_year: '2026' }
    ]);
    
    render(<Semesters />, { wrapper: Wrapper });
    
    await waitFor(() => {
      expect(screen.getByText('Fall 2026')).not.toBeNull();
      expect(screen.getByText('2026')).not.toBeNull();
    });
  });

  test('validates semester creation form', async () => {
    (api.get as any).mockResolvedValueOnce([]);
    
    render(<Semesters />, { wrapper: Wrapper });
    
    await waitFor(() => {
      expect(screen.getByText(/no semesters/i)).not.toBeNull();
    });
    
    fireEvent.click(screen.getByRole('button', { name: /add semester/i }));
    
    // Submit empty form
    fireEvent.click(screen.getByRole('button', { name: /create semester/i }));
    
    await waitFor(() => {
      expect(screen.getByText(/name is required/i)).not.toBeNull();
      expect(screen.getByText(/academic year is required/i)).not.toBeNull();
    });
  });

  test('creates semester successfully', async () => {
    (api.get as any).mockResolvedValueOnce([]);
    (api.post as any).mockResolvedValueOnce({ id: '2', name: 'Spring 2027', academic_year: '2027' });
    
    render(<Semesters />, { wrapper: Wrapper });
    
    await waitFor(() => {
      expect(screen.getByText(/no semesters/i)).not.toBeNull();
    });
    
    fireEvent.click(screen.getByRole('button', { name: /add semester/i }));
    
    fireEvent.change(screen.getByLabelText(/semester name/i), { target: { value: 'Spring 2027' } });
    fireEvent.change(screen.getByLabelText(/academic year/i), { target: { value: '2027' } });
    
    fireEvent.click(screen.getByRole('button', { name: /create semester/i }));
    
    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith('/semesters', {
        name: 'Spring 2027',
        academic_year: '2027'
      });
    });
  });

  test('deletes semester and invalidates queries', async () => {
    (api.get as any).mockResolvedValueOnce([
      { id: '1', name: 'Fall 2026', academic_year: '2026' }
    ]);
    (api.delete as any).mockResolvedValueOnce({});

    // Mock window.confirm
    const confirmSpy = vi.spyOn(window, 'confirm').mockImplementation(() => true);
    const invalidateQueriesSpy = vi.spyOn(queryClient, 'invalidateQueries');

    render(<Semesters />, { wrapper: Wrapper });

    await waitFor(() => {
      expect(screen.getByText('Fall 2026')).not.toBeNull();
    });

    fireEvent.click(screen.getByRole('button', { name: /delete/i }));

    await waitFor(() => {
      expect(api.delete).toHaveBeenCalledWith('/semesters/1');
      expect(invalidateQueriesSpy).toHaveBeenCalledWith({ queryKey: ['semesters'] });
      expect(invalidateQueriesSpy).toHaveBeenCalledWith({ queryKey: ['dashboard'] });
      expect(invalidateQueriesSpy).toHaveBeenCalledWith({ queryKey: ['subjects'] });
    });

    confirmSpy.mockRestore();
    invalidateQueriesSpy.mockRestore();
  });
});
