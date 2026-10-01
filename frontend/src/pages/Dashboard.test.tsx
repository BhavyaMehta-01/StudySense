import { render, screen, waitFor } from '@testing-library/react';
import { describe, test, expect, vi, beforeEach } from 'vitest';
import { BrowserRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import Dashboard from './Dashboard';
import { api } from '@/api/client';

vi.mock('@/api/client', () => ({
  api: {
    get: vi.fn(),
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

describe('Dashboard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queryClient.clear();
  });

  test('renders loading state', () => {
    // Return a promise that never resolves to keep it in loading state
    (api.get as any).mockReturnValue(new Promise(() => {}));
    
    render(<Dashboard />, { wrapper: Wrapper });
    expect(screen.getByText(/loading dashboard data/i)).not.toBeNull();
  });

  test('renders error state', async () => {
    (api.get as any).mockRejectedValue(new Error('API Error'));
    
    render(<Dashboard />, { wrapper: Wrapper });
    
    await waitFor(() => {
      expect(screen.getByText(/error loading dashboard/i)).not.toBeNull();
    });
  });

  test('renders empty state when no subjects exist', async () => {
    (api.get as any).mockResolvedValue({
      total_semesters: 0,
      total_subjects: 0,
      subject_summaries: []
    });
    
    render(<Dashboard />, { wrapper: Wrapper });
    
    await waitFor(() => {
      expect(screen.getByText(/no data available/i)).not.toBeNull();
      expect(screen.getByText(/haven't added any academic data yet/i)).not.toBeNull();
    });
  });

  test('renders populated dashboard with correct data and links', async () => {
    (api.get as any).mockResolvedValue({
      total_semesters: 1,
      total_subjects: 1,
      subject_summaries: [
        {
          semester_id: 'sem-123',
          semester_name: 'Fall 2026',
          subject_id: 'sub-456',
          subject_name: 'Database Systems',
          earned_points: '85.50',
          completed_weight: '100.00',
          pending_weight: '0.00',
          completed_work_percentage: '85.50',
          attendance_percentage: '90.00'
        }
      ]
    });
    
    render(<Dashboard />, { wrapper: Wrapper });
    
    await waitFor(() => {
      expect(screen.getByText('Total Semesters')).not.toBeNull();
    });

    // Check header values
    expect(screen.getAllByText('1').length).toBe(2); // semesters and subjects

    // Check subject data
    expect(screen.getByText('Database Systems')).not.toBeNull();
    expect(screen.getByText('Fall 2026')).not.toBeNull();
    expect(screen.getByText('85.50')).not.toBeNull(); // earned points
    expect(screen.getByText('86%')).not.toBeNull(); // 85.5 rounded
    expect(screen.getByText('90%')).not.toBeNull(); // 90.0 rounded

    // Check that link is correct
    const link = screen.getByRole('link');
    expect(link.getAttribute('href')).toBe('/app/semesters/sem-123/subjects/sub-456');
  });
});
