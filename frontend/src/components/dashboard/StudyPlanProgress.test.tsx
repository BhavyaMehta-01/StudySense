import { render, screen, waitFor } from '@testing-library/react';
import { describe, test, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import StudyPlanProgress from './StudyPlanProgress';
import { api, ApiError } from '@/api/client';

vi.mock('@/api/client', () => ({
  api: {
    get: vi.fn(),
  },
  ApiError: class ApiError extends Error {
    public status: number;
    public data: any;
    constructor(status: number, data: any) {
      super(data?.detail || 'API Error');
      this.status = status;
      this.data = data;
      this.name = 'ApiError';
    }
  },
}));

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false } },
});

const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <QueryClientProvider client={queryClient}>
    {children}
  </QueryClientProvider>
);

describe('StudyPlanProgress', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queryClient.clear();
  });

  test('renders loading state while fetching plan and semester', () => {
    (api.get as any).mockReturnValue(new Promise(() => {}));

    render(<StudyPlanProgress />, { wrapper: Wrapper });
    expect(screen.getByText(/loading study plan progress/i)).not.toBeNull();
  });

  test('renders no active semester state when no semester is marked active', async () => {
    (api.get as any).mockImplementation((url: string) => {
      if (url === '/semesters') {
        return Promise.resolve([
          { id: 'sem-1', name: 'Fall 2025', academic_year: '2025', is_active: false },
        ]);
      }
      return Promise.resolve(null);
    });

    render(<StudyPlanProgress />, { wrapper: Wrapper });

    await waitFor(() => {
      expect(screen.getByText(/no active semester/i)).not.toBeNull();
      expect(screen.getByText(/do not have an active semester selected/i)).not.toBeNull();
    });
  });

  test('renders no active plan state on 404 API response', async () => {
    (api.get as any).mockImplementation((url: string) => {
      if (url === '/semesters') {
        return Promise.resolve([
          { id: 'sem-1', name: 'Fall 2026', academic_year: '2026', is_active: true },
        ]);
      }
      if (url === '/study-plans/active') {
        return Promise.reject(new (ApiError as any)(404, { detail: 'No active study plan found' }));
      }
      return Promise.resolve(null);
    });

    render(<StudyPlanProgress />, { wrapper: Wrapper });

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /no active study plan/i })).not.toBeNull();
      expect(screen.getByText(/no active study plan found for fall 2026/i)).not.toBeNull();
    });
  });

  test('renders error state on non-404 API failure', async () => {
    (api.get as any).mockImplementation((url: string) => {
      if (url === '/semesters') {
        return Promise.resolve([
          { id: 'sem-1', name: 'Fall 2026', academic_year: '2026', is_active: true },
        ]);
      }
      if (url === '/study-plans/active') {
        return Promise.reject(new (ApiError as any)(500, { detail: 'Internal Server Error' }));
      }
      return Promise.resolve(null);
    });

    render(<StudyPlanProgress />, { wrapper: Wrapper });

    await waitFor(() => {
      expect(screen.getByText(/error loading study plan/i)).not.toBeNull();
      expect(screen.getByText(/could not retrieve study plan data/i)).not.toBeNull();
    });
  });

  test('renders empty study plan state when allocations list is empty', async () => {
    (api.get as any).mockImplementation((url: string) => {
      if (url === '/semesters') {
        return Promise.resolve([
          { id: 'sem-1', name: 'Fall 2026', academic_year: '2026', is_active: true },
        ]);
      }
      if (url === '/study-plans/active') {
        return Promise.resolve({
          id: 'plan-empty',
          user_id: 'user-1',
          start_date: '2026-10-12',
          end_date: '2026-10-18',
          available_minutes: 100,
          is_active: true,
          allocations: [],
        });
      }
      return Promise.resolve([]);
    });

    render(<StudyPlanProgress />, { wrapper: Wrapper });

    await waitFor(() => {
      expect(screen.getByText(/empty study plan/i)).not.toBeNull();
      expect(screen.getByText(/this study plan has no allocations/i)).not.toBeNull();
    });
  });

  test('renders plan with allocations and aggregates session minutes correctly', async () => {
    const mockPlan = {
      id: 'plan-1',
      user_id: 'user-1',
      start_date: '2026-10-12',
      end_date: '2026-10-18',
      available_minutes: 180,
      is_active: true,
      allocations: [
        {
          id: 'alloc-1',
          plan_id: 'plan-1',
          subject_id: 'sub-1',
          allocated_minutes: 120,
          snapshot_state: {
            subject_name: 'Data Structures',
            subject_target: 85,
            target_deficit: 15,
          },
          explanation_code: 'urgent_and_deficit',
        },
        {
          id: 'alloc-2',
          plan_id: 'plan-1',
          subject_id: 'sub-2',
          allocated_minutes: 60,
          snapshot_state: {
            subject_name: 'Discrete Math',
          },
          explanation_code: 'exam_approaching',
        },
      ],
    };

    const mockSessions = [
      { id: 's-1', allocation_id: 'alloc-1', date: '2026-10-12', duration_minutes: 40, status: 'completed' },
      { id: 's-2', allocation_id: 'alloc-1', date: '2026-10-13', duration_minutes: 50, status: 'completed' },
      // total for alloc-1 = 90 / 120 min (75%)
      { id: 's-3', allocation_id: 'alloc-2', date: '2026-10-14', duration_minutes: 80, status: 'completed' },
      // total for alloc-2 = 80 / 60 min (133%) -> over-allocated!
    ];

    (api.get as any).mockImplementation((url: string) => {
      if (url === '/semesters') {
        return Promise.resolve([
          { id: 'sem-1', name: 'Fall 2026', academic_year: '2026', is_active: true },
        ]);
      }
      if (url === '/study-plans/active') {
        return Promise.resolve(mockPlan);
      }
      if (url.startsWith('/study-sessions')) {
        return Promise.resolve(mockSessions);
      }
      return Promise.resolve(null);
    });

    render(<StudyPlanProgress />, { wrapper: Wrapper });

    await waitFor(() => {
      expect(screen.getByText('3 study sessions recorded for this plan')).not.toBeNull();
    });

    // Check Header and Budget
    expect(screen.getByText('Weekly Study Plan')).not.toBeNull();
    expect(screen.getByText(/180 min available weekly/i)).not.toBeNull();
    expect(screen.getByText('180 min')).not.toBeNull(); // Total planned
    expect(screen.getByText('170 min')).not.toBeNull(); // Total logged: 40 + 50 + 80 = 170

    // Check Allocation 1 (Data Structures)
    expect(screen.getByText('Data Structures')).not.toBeNull();
    expect(screen.getByText('Target: 85%')).not.toBeNull();
    expect(screen.getByText('urgent and deficit')).not.toBeNull();
    expect(screen.getByText('90 / 120 min (75%)')).not.toBeNull();

    // Check Allocation 2 (Discrete Math - over allocated)
    expect(screen.getByText('Discrete Math')).not.toBeNull();
    expect(screen.getByText('exam approaching')).not.toBeNull();
    expect(screen.getByText('80 / 60 min (133%)')).not.toBeNull();
    expect(screen.getByText('+20 min over planned allocation')).not.toBeNull();

    // Check accessible progress bars
    const progressBars = screen.getAllByRole('progressbar');
    expect(progressBars.length).toBe(3); // 1 overall + 2 allocations
    expect(progressBars[1].getAttribute('aria-valuenow')).toBe('90');
    expect(progressBars[1].getAttribute('aria-valuemax')).toBe('120');
    expect(progressBars[2].getAttribute('aria-valuenow')).toBe('80');
    expect(progressBars[2].getAttribute('aria-valuemax')).toBe('60');
  });

  test('handles empty session history cleanly', async () => {
    const mockPlan = {
      id: 'plan-1',
      user_id: 'user-1',
      start_date: '2026-10-12',
      end_date: '2026-10-18',
      available_minutes: 60,
      is_active: true,
      allocations: [
        {
          id: 'alloc-1',
          plan_id: 'plan-1',
          subject_id: 'sub-1',
          allocated_minutes: 60,
          snapshot_state: { subject_name: 'Operating Systems' },
          explanation_code: 'no_work_needed',
        },
      ],
    };

    (api.get as any).mockImplementation((url: string) => {
      if (url === '/semesters') {
        return Promise.resolve([
          { id: 'sem-1', name: 'Fall 2026', academic_year: '2026', is_active: true },
        ]);
      }
      if (url === '/study-plans/active') {
        return Promise.resolve(mockPlan);
      }
      if (url.startsWith('/study-sessions')) {
        return Promise.resolve([]);
      }
      return Promise.resolve(null);
    });

    render(<StudyPlanProgress />, { wrapper: Wrapper });

    await waitFor(() => {
      expect(screen.getByText(/no study sessions recorded yet for this plan/i)).not.toBeNull();
    });

    expect(screen.getByText('Operating Systems')).not.toBeNull();
    expect(screen.getAllByText('0 / 60 min (0%)').length).toBe(2);
  });
});
