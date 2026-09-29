import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, test, expect, vi, beforeEach } from 'vitest';
import { BrowserRouter, Routes, Route } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import SemesterDetail from './SemesterDetail';
import { api } from '@/api/client';

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
    <BrowserRouter>
      <Routes>
        <Route path="/app/semesters/:semesterId" element={children} />
      </Routes>
    </BrowserRouter>
  </QueryClientProvider>
);

describe('SemesterDetail', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queryClient.clear();
    // mock window.history to have a param
    window.history.pushState({}, 'Test', '/app/semesters/123');
  });

  test('renders semester details and subjects', async () => {
    (api.get as any).mockImplementation((url: string) => {
      if (url === '/semesters/123') {
        return Promise.resolve({ id: '123', name: 'Fall 2026', academic_year: '2026' });
      }
      if (url === '/semesters/123/subjects') {
        return Promise.resolve([{ id: '1', name: 'Math 101', code: 'M101', credits: 4 }]);
      }
      return Promise.resolve(null);
    });
    
    render(<SemesterDetail />, { wrapper: Wrapper });
    
    await waitFor(() => {
      expect(screen.getByText('Fall 2026')).not.toBeNull();
      expect(screen.getByText('Academic Year: 2026')).not.toBeNull();
      expect(screen.getByText('Math 101')).not.toBeNull();
      expect(screen.getByText('Code: M101')).not.toBeNull();
      expect(screen.getByText('Credits: 4')).not.toBeNull();
    });
  });

  test('validates subject creation form', async () => {
    (api.get as any).mockImplementation((url: string) => {
      if (url === '/semesters/123') return Promise.resolve({ id: '123', name: 'Fall' });
      return Promise.resolve([]);
    });
    
    render(<SemesterDetail />, { wrapper: Wrapper });
    
    await waitFor(() => {
      expect(screen.getByText('Fall')).not.toBeNull();
    });
    
    fireEvent.click(screen.getByRole('button', { name: /add subject/i }));
    fireEvent.click(screen.getByRole('button', { name: /create subject/i }));
    
    await waitFor(() => {
      expect(screen.getByText(/name is required/i)).not.toBeNull();
    });
  });

  test('creates subject successfully', async () => {
    (api.get as any).mockImplementation((url: string) => {
      if (url === '/semesters/123') return Promise.resolve({ id: '123', name: 'Fall' });
      return Promise.resolve([]);
    });
    (api.post as any).mockResolvedValueOnce({ id: '2', name: 'Physics' });
    
    render(<SemesterDetail />, { wrapper: Wrapper });
    
    await waitFor(() => {
      expect(screen.getByText('Fall')).not.toBeNull();
    });
    
    fireEvent.click(screen.getByRole('button', { name: /add subject/i }));
    
    fireEvent.change(screen.getByLabelText(/subject name \*/i), { target: { value: 'Physics' } });
    fireEvent.change(screen.getByLabelText(/course code/i), { target: { value: 'PHY101' } });
    fireEvent.change(screen.getByLabelText(/credits/i), { target: { value: '3' } });
    
    fireEvent.click(screen.getByRole('button', { name: /create subject/i }));
    
    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith('/semesters/123/subjects', {
        name: 'Physics',
        code: 'PHY101',
        credits: 3
      });
    });
  });
});
