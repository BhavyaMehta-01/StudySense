import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { describe, test, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import LogStudySessionForm from './LogStudySessionForm';
import { api, ApiError } from '@/api/client';
import type { StudyPlan } from '@/types/api';

vi.mock('@/api/client', () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
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
  defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
});

const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <QueryClientProvider client={queryClient}>
    {children}
  </QueryClientProvider>
);

const mockPlan: StudyPlan = {
  id: 'plan-1',
  user_id: 'user-1',
  start_date: '2026-10-12',
  end_date: '2026-10-18',
  available_minutes: 180,
  is_active: true,
  created_at: '2026-10-11T00:00:00Z',
  updated_at: null,
  allocations: [
    {
      id: 'alloc-1',
      plan_id: 'plan-1',
      subject_id: 'sub-1',
      allocated_minutes: 120,
      snapshot_state: { subject_name: 'Operating Systems' },
      explanation_code: 'deficit_priority',
    },
    {
      id: 'alloc-2',
      plan_id: 'plan-1',
      subject_id: 'sub-2',
      allocated_minutes: 60,
      snapshot_state: { subject_name: 'Algorithms' },
      explanation_code: 'exam_prep',
    },
  ],
};

describe('LogStudySessionForm', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queryClient.clear();
  });

  test('renders form with plan allocations and default fields', () => {
    render(<LogStudySessionForm plan={mockPlan} />, { wrapper: Wrapper });

    expect(screen.getByText('Log Study Session')).not.toBeNull();
    expect(screen.getByLabelText(/subject allocation/i)).not.toBeNull();
    expect(screen.getByLabelText(/date/i)).not.toBeNull();
    expect(screen.getByLabelText(/status/i)).not.toBeNull();
    expect(screen.getByLabelText(/duration/i)).not.toBeNull();

    // Verify allocation options
    expect(screen.getByText('Operating Systems (120 min planned)')).not.toBeNull();
    expect(screen.getByText('Algorithms (60 min planned)')).not.toBeNull();
  });

  test('pre-selects initial allocation when provided', () => {
    render(<LogStudySessionForm plan={mockPlan} initialAllocationId="alloc-2" />, {
      wrapper: Wrapper,
    });

    const allocSelect = screen.getByLabelText(/subject allocation/i) as HTMLSelectElement;
    expect(allocSelect.value).toBe('alloc-2');
  });

  test('validates duration must be positive for completed or partial sessions', async () => {
    render(<LogStudySessionForm plan={mockPlan} />, { wrapper: Wrapper });

    const durationInput = screen.getByLabelText(/duration/i);
    fireEvent.change(durationInput, { target: { value: '0' } });

    fireEvent.click(screen.getByRole('button', { name: /save study session/i }));

    expect(
      screen.getByText(/duration must be greater than 0 for completed sessions/i)
    ).not.toBeNull();
    expect(api.post).not.toHaveBeenCalled();
  });

  test('validates date must be within plan period', async () => {
    render(<LogStudySessionForm plan={mockPlan} />, { wrapper: Wrapper });

    const dateInput = screen.getByLabelText(/date/i);
    fireEvent.change(dateInput, { target: { value: '2026-10-01' } }); // before 2026-10-12

    fireEvent.click(screen.getByRole('button', { name: /save study session/i }));

    expect(
      screen.getByText(/date must be within the plan period \(2026-10-12 to 2026-10-18\)/i)
    ).not.toBeNull();
    expect(api.post).not.toHaveBeenCalled();
  });

  test('automatically sets duration to 0 and disables duration input when status is skipped', async () => {
    (api.post as any).mockResolvedValue({
      id: 'session-1',
      allocation_id: 'alloc-1',
      date: '2026-10-15',
      duration_minutes: 0,
      status: 'skipped',
    });

    render(<LogStudySessionForm plan={mockPlan} />, { wrapper: Wrapper });

    const statusSelect = screen.getByLabelText(/status/i);
    fireEvent.change(statusSelect, { target: { value: 'skipped' } });

    const durationInput = screen.getByLabelText(/duration/i) as HTMLInputElement;
    expect(durationInput.value).toBe('0');
    expect(durationInput.disabled).toBe(true);

    const dateInput = screen.getByLabelText(/date/i);
    fireEvent.change(dateInput, { target: { value: '2026-10-15' } });

    fireEvent.click(screen.getByRole('button', { name: /save study session/i }));

    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith('/study-sessions', {
        allocation_id: 'alloc-1',
        date: '2026-10-15',
        duration_minutes: 0,
        status: 'skipped',
      });
    });
  });

  test('submits successfully and triggers query invalidation', async () => {
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
    (api.post as any).mockResolvedValue({
      id: 'session-new',
      allocation_id: 'alloc-1',
      date: '2026-10-14',
      duration_minutes: 45,
      status: 'completed',
    });

    const onSuccess = vi.fn();
    render(<LogStudySessionForm plan={mockPlan} onSuccess={onSuccess} />, {
      wrapper: Wrapper,
    });

    const dateInput = screen.getByLabelText(/date/i);
    fireEvent.change(dateInput, { target: { value: '2026-10-14' } });

    const durationInput = screen.getByLabelText(/duration/i);
    fireEvent.change(durationInput, { target: { value: '45' } });

    fireEvent.click(screen.getByRole('button', { name: /save study session/i }));

    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith('/study-sessions', {
        allocation_id: 'alloc-1',
        date: '2026-10-14',
        duration_minutes: 45,
        status: 'completed',
      });
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['study-sessions'] });
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['study-plans'] });
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['dashboard'] });
      expect(onSuccess).toHaveBeenCalled();
    });
  });

  test('prevents duplicate submissions while request is pending', async () => {
    let resolvePost: any;
    (api.post as any).mockImplementation(
      () =>
        new Promise((resolve) => {
          resolvePost = resolve;
        })
    );

    render(<LogStudySessionForm plan={mockPlan} />, { wrapper: Wrapper });

    const dateInput = screen.getByLabelText(/date/i);
    fireEvent.change(dateInput, { target: { value: '2026-10-14' } });

    const submitBtn = screen.getByRole('button', { name: /save study session/i });
    fireEvent.click(submitBtn);

    // Button should be disabled and show loading state
    expect(screen.getByRole('button', { name: /saving\.\.\./i })).not.toBeNull();
    expect((screen.getByRole('button', { name: /saving\.\.\./i }) as HTMLButtonElement).disabled).toBe(
      true
    );

    // Clicking again should not invoke api.post a second time
    fireEvent.click(submitBtn);
    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1));

    // Resolve request
    resolvePost({ id: 's-1' });
    await waitFor(() => {
      expect(screen.getByText(/study session logged successfully/i)).not.toBeNull();
    });
  });

  test('displays API error and preserves entered values on failure', async () => {
    (api.post as any).mockRejectedValue(
      new (ApiError as any)(400, { detail: 'Date must be within the StudyPlan period' })
    );

    render(<LogStudySessionForm plan={mockPlan} />, { wrapper: Wrapper });

    const dateInput = screen.getByLabelText(/date/i) as HTMLInputElement;
    fireEvent.change(dateInput, { target: { value: '2026-10-14' } });

    const durationInput = screen.getByLabelText(/duration/i) as HTMLInputElement;
    fireEvent.change(durationInput, { target: { value: '75' } });

    fireEvent.click(screen.getByRole('button', { name: /save study session/i }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).not.toBeNull();
      expect(screen.getByText('Date must be within the StudyPlan period')).not.toBeNull();
    });

    // Verify entered values are preserved
    expect(dateInput.value).toBe('2026-10-14');
    expect(durationInput.value).toBe('75');
  });
});
