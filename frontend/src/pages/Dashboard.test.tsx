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
    expect(screen.getByText('Earned Points')).not.toBeNull();
    expect(screen.getByText('Current Average')).not.toBeNull();
    expect(screen.getByText('Course Completion')).not.toBeNull();
    expect(screen.getByText('Attendance')).not.toBeNull();
    expect(screen.getByText('85.50')).not.toBeNull(); // earned points
    expect(screen.getByText('86%')).not.toBeNull(); // 85.5 Current Average rounded
    expect(screen.getByText('100%')).not.toBeNull(); // 100.0 Course Completion
    expect(screen.getByText('90%')).not.toBeNull(); // 90.0 attendance rounded

    // Check that link is correct
    const link = screen.getByRole('link');
    expect(link.getAttribute('href')).toBe('/app/semesters/sem-123/subjects/sub-456');
  });

  test('renders Current Average and Course Completion for the QA reproduction scenario', async () => {
    (api.get as any).mockResolvedValue({
      total_semesters: 1,
      total_subjects: 2,
      subject_summaries: [
        {
          semester_id: 'sem-1',
          semester_name: 'Fall 2026',
          subject_id: 'sub-de',
          subject_name: 'Digital Electronics',
          earned_points: '24.00',
          completed_weight: '50.00',
          pending_weight: '10.00',
          completed_work_percentage: '48.00',
          attendance_percentage: '85.00',
        },
        {
          semester_id: 'sem-1',
          semester_name: 'Fall 2026',
          subject_id: 'sub-new',
          subject_name: 'New Course',
          earned_points: '0.00',
          completed_weight: '0.00',
          pending_weight: '50.00',
          completed_work_percentage: null,
          attendance_percentage: null,
        },
      ],
    });

    render(<Dashboard />, { wrapper: Wrapper });

    await waitFor(() => {
      expect(screen.getByText('Digital Electronics')).not.toBeNull();
    });

    // Digital Electronics QA scenario checks
    expect(screen.getByText('24.00')).not.toBeNull(); // Earned Points
    expect(screen.getByText('48%')).not.toBeNull();   // Current Average (24/50)
    expect(screen.getByText('50%')).not.toBeNull();   // Course Completion (50% completed weight)

    // New Course with no completed assessments checks
    expect(screen.getByText('New Course')).not.toBeNull();
    expect(screen.getByText('0%')).not.toBeNull();    // Course Completion (0%)
    expect(screen.getAllByText('N/A').length).toBeGreaterThanOrEqual(2); // Current Average N/A, Attendance N/A
  });

  test('renders populated dashboard with study plan progress integrated', async () => {
    (api.get as any).mockImplementation((url: string) => {
      if (url === '/dashboard') {
        return Promise.resolve({
          total_semesters: 1,
          total_subjects: 1,
          subject_summaries: [
            {
              semester_id: 'sem-1',
              semester_name: 'Fall 2026',
              subject_id: 'sub-1',
              subject_name: 'Database Systems',
              earned_points: '85.50',
              completed_weight: '100.00',
              pending_weight: '0.00',
              completed_work_percentage: '85.50',
              attendance_percentage: '90.00',
            },
          ],
        });
      }
      if (url === '/semesters') {
        return Promise.resolve([
          { id: 'sem-1', name: 'Fall 2026', academic_year: '2026', is_active: true },
        ]);
      }
      if (url === '/study-plans/active') {
        return Promise.resolve({
          id: 'plan-1',
          user_id: 'u-1',
          start_date: '2026-10-12',
          end_date: '2026-10-18',
          available_minutes: 120,
          is_active: true,
          allocations: [
            {
              id: 'alloc-1',
              plan_id: 'plan-1',
              subject_id: 'sub-1',
              allocated_minutes: 120,
              snapshot_state: { subject_name: 'Database Systems', subject_target: 90 },
              explanation_code: 'deficit_priority',
            },
          ],
        });
      }
      if (url.startsWith('/study-sessions')) {
        return Promise.resolve([
          { id: 's-1', allocation_id: 'alloc-1', date: '2026-10-12', duration_minutes: 60, status: 'completed' },
        ]);
      }
      return Promise.resolve(null);
    });

    render(<Dashboard />, { wrapper: Wrapper });

    // Wait for full cascade of queries (dashboard, plan, and sessions) to render
    await waitFor(() => {
      expect(screen.getByText('1 study session recorded for this plan')).not.toBeNull();
    });

    // Check study plan progress details
    expect(screen.getByText('Subject Performance')).not.toBeNull();
    expect(screen.getByText('Weekly Study Plan')).not.toBeNull();
    expect(screen.getAllByText('60 / 120 min (50%)').length).toBe(2);

    // Check existing dashboard performance section intact
    expect(screen.getByText('Total Semesters')).not.toBeNull();
    expect(screen.getByText('Total Subjects')).not.toBeNull();
  });
});
