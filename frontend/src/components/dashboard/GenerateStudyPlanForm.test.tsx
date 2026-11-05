import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { describe, test, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import GenerateStudyPlanForm from './GenerateStudyPlanForm';
import {
  getDefaultWeekRange,
  isMonday,
  isSunday,
  isPlanExpired,
} from './studyPlanDates';
import { api, ApiError } from '@/api/client';
import type { Semester } from '@/types/api';

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

const mockSemester: Semester = {
  id: 'sem-1',
  user_id: 'user-1',
  name: 'Fall 2026',
  academic_year: '2026',
  is_active: true,
  created_at: '2026-08-01T00:00:00Z',
  updated_at: null,
};

describe('getDefaultWeekRange', () => {
  test('returns current week when today is Monday', () => {
    // 2026-10-12 is Monday
    const monday = new Date(2026, 9, 12);
    const range = getDefaultWeekRange(monday);
    expect(range.startDate).toBe('2026-10-12');
    expect(range.endDate).toBe('2026-10-18');
  });

  test('returns next week when today is Sunday', () => {
    // 2026-10-18 is Sunday
    const sunday = new Date(2026, 9, 18);
    const range = getDefaultWeekRange(sunday);
    expect(range.startDate).toBe('2026-10-19');
    expect(range.endDate).toBe('2026-10-25');
  });

  test('returns next Monday to Sunday when today is midweek (Wednesday)', () => {
    // 2026-10-14 is Wednesday
    const wednesday = new Date(2026, 9, 14);
    const range = getDefaultWeekRange(wednesday);
    expect(range.startDate).toBe('2026-10-19');
    expect(range.endDate).toBe('2026-10-25');
  });

  test('correctly handles month/year boundaries', () => {
    // 2026-12-30 is Wednesday -> next Monday is 2027-01-04
    const decWed = new Date(2026, 11, 30);
    const range = getDefaultWeekRange(decWed);
    expect(range.startDate).toBe('2027-01-04');
    expect(range.endDate).toBe('2027-01-10');
  });
});

describe('isMonday and isSunday validators', () => {
  test('correctly identifies Mondays and Sundays', () => {
    expect(isMonday('2026-10-12')).toBe(true);
    expect(isMonday('2026-10-13')).toBe(false);
    expect(isMonday('')).toBe(false);

    expect(isSunday('2026-10-18')).toBe(true);
    expect(isSunday('2026-10-17')).toBe(false);
    expect(isSunday('')).toBe(false);
  });
});

describe('isPlanExpired', () => {
  test('returns true when current date is strictly past end date', () => {
    // Current date is 2026-10-19 (Monday), plan ended 2026-10-18 (Sunday)
    const monday = new Date(2026, 9, 19);
    expect(isPlanExpired('2026-10-18', monday)).toBe(true);
  });

  test('returns false when current date is on or before end date', () => {
    // Current date is 2026-10-18 (Sunday, last day of plan)
    const sunday = new Date(2026, 9, 18);
    expect(isPlanExpired('2026-10-18', sunday)).toBe(false);

    // Current date is 2026-10-15 (midweek)
    const midweek = new Date(2026, 9, 15);
    expect(isPlanExpired('2026-10-18', midweek)).toBe(false);

    // Current date is in the past relative to plan end date
    const earlier = new Date(2026, 9, 10);
    expect(isPlanExpired('2026-10-18', earlier)).toBe(false);
  });

  test('returns false for empty or missing date string', () => {
    expect(isPlanExpired('')).toBe(false);
  });
});

describe('GenerateStudyPlanForm', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queryClient.clear();
  });

  test('renders form with default date range, 600 minutes, and semester name', () => {
    render(<GenerateStudyPlanForm activeSemester={mockSemester} />, { wrapper: Wrapper });

    expect(screen.getByText('Create Weekly Study Plan')).not.toBeNull();
    expect(screen.getByText(/Generating plan for/i)).not.toBeNull();
    expect(screen.getByText('Fall 2026')).not.toBeNull();

    const startInput = screen.getByLabelText(/week start/i) as HTMLInputElement;
    const endInput = screen.getByLabelText(/week end/i) as HTMLInputElement;
    const minutesInput = screen.getByLabelText(/weekly available study time/i) as HTMLInputElement;

    expect(isMonday(startInput.value)).toBe(true);
    expect(isSunday(endInput.value)).toBe(true);
    expect(minutesInput.value).toBe('600');
  });

  test('validates start date must be Monday', () => {
    render(<GenerateStudyPlanForm activeSemester={mockSemester} />, { wrapper: Wrapper });

    const startInput = screen.getByLabelText(/week start/i);
    fireEvent.change(startInput, { target: { value: '2026-10-13' } }); // Tuesday

    fireEvent.click(screen.getByRole('button', { name: /generate study plan/i }));

    expect(screen.getByText('Start date must be a Monday.')).not.toBeNull();
    expect(api.post).not.toHaveBeenCalled();
  });

  test('validates end date must be Sunday', () => {
    render(<GenerateStudyPlanForm activeSemester={mockSemester} />, { wrapper: Wrapper });

    const startInput = screen.getByLabelText(/week start/i);
    fireEvent.change(startInput, { target: { value: '2026-10-12' } }); // Monday

    const endInput = screen.getByLabelText(/week end/i);
    fireEvent.change(endInput, { target: { value: '2026-10-17' } }); // Saturday

    fireEvent.click(screen.getByRole('button', { name: /generate study plan/i }));

    expect(screen.getByText('End date must be a Sunday.')).not.toBeNull();
    expect(api.post).not.toHaveBeenCalled();
  });

  test('validates study time must be positive integer divisible by 5', () => {
    render(<GenerateStudyPlanForm activeSemester={mockSemester} />, { wrapper: Wrapper });

    const startInput = screen.getByLabelText(/week start/i);
    fireEvent.change(startInput, { target: { value: '2026-10-12' } });
    const endInput = screen.getByLabelText(/week end/i);
    fireEvent.change(endInput, { target: { value: '2026-10-18' } });

    const minutesInput = screen.getByLabelText(/weekly available study time/i);

    // Negative minutes
    fireEvent.change(minutesInput, { target: { value: '-10' } });
    fireEvent.click(screen.getByRole('button', { name: /generate study plan/i }));
    expect(screen.getByText('Weekly study time must be a positive whole number.')).not.toBeNull();
    expect(api.post).not.toHaveBeenCalled();

    // Zero minutes
    fireEvent.change(minutesInput, { target: { value: '0' } });
    fireEvent.click(screen.getByRole('button', { name: /generate study plan/i }));
    expect(screen.getByText('Weekly study time must be a positive whole number.')).not.toBeNull();
    expect(api.post).not.toHaveBeenCalled();

    // Not divisible by 5
    fireEvent.change(minutesInput, { target: { value: '123' } });
    fireEvent.click(screen.getByRole('button', { name: /generate study plan/i }));
    expect(screen.getByText('Weekly study time must be divisible by 5 minutes.')).not.toBeNull();
    expect(api.post).not.toHaveBeenCalled();
  });

  test('submits successfully and invalidates queries', async () => {
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
    (api.post as any).mockResolvedValue({
      id: 'plan-new',
      user_id: 'user-1',
      start_date: '2026-10-12',
      end_date: '2026-10-18',
      available_minutes: 600,
      is_active: true,
      allocations: [],
    });

    const onSuccess = vi.fn();
    render(<GenerateStudyPlanForm activeSemester={mockSemester} onSuccess={onSuccess} />, {
      wrapper: Wrapper,
    });

    const startInput = screen.getByLabelText(/week start/i);
    fireEvent.change(startInput, { target: { value: '2026-10-12' } });

    const endInput = screen.getByLabelText(/week end/i);
    fireEvent.change(endInput, { target: { value: '2026-10-18' } });

    const minutesInput = screen.getByLabelText(/weekly available study time/i);
    fireEvent.change(minutesInput, { target: { value: '600' } });

    fireEvent.click(screen.getByRole('button', { name: /generate study plan/i }));

    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith('/study-plans', {
        start_date: '2026-10-12',
        end_date: '2026-10-18',
        available_minutes: 600,
      });
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['study-plans'] });
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['study-sessions'] });
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['dashboard'] });
      expect(onSuccess).toHaveBeenCalled();
      expect(screen.getByText(/weekly study plan generated successfully/i)).not.toBeNull();
    });

    invalidateSpy.mockRestore();
  });

  test('prevents duplicate submissions while request is pending', async () => {
    let resolvePost: any;
    (api.post as any).mockImplementation(
      () =>
        new Promise((resolve) => {
          resolvePost = resolve;
        })
    );

    render(<GenerateStudyPlanForm activeSemester={mockSemester} />, { wrapper: Wrapper });

    const startInput = screen.getByLabelText(/week start/i);
    fireEvent.change(startInput, { target: { value: '2026-10-12' } });
    const endInput = screen.getByLabelText(/week end/i);
    fireEvent.change(endInput, { target: { value: '2026-10-18' } });

    const submitBtn = screen.getByRole('button', { name: /generate study plan/i });
    fireEvent.click(submitBtn);

    // Button should be disabled and show loading state
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /generating plan\.\.\./i })).not.toBeNull();
      expect(
        (screen.getByRole('button', { name: /generating plan\.\.\./i }) as HTMLButtonElement).disabled
      ).toBe(true);
    });

    // Clicking again should not trigger another api.post
    fireEvent.click(submitBtn);
    expect(api.post).toHaveBeenCalledTimes(1);

    // Resolve post
    resolvePost({ id: 'plan-created' });
    await waitFor(() => {
      expect(screen.getByText(/weekly study plan generated successfully/i)).not.toBeNull();
    });
  });

  test('handles HTTP 400 with actionable error message and preserves inputs', async () => {
    (api.post as any).mockRejectedValue(
      new (ApiError as any)(400, { detail: 'No eligible subjects or assessments found' })
    );

    render(<GenerateStudyPlanForm activeSemester={mockSemester} />, { wrapper: Wrapper });

    const startInput = screen.getByLabelText(/week start/i) as HTMLInputElement;
    fireEvent.change(startInput, { target: { value: '2026-10-12' } });

    const endInput = screen.getByLabelText(/week end/i) as HTMLInputElement;
    fireEvent.change(endInput, { target: { value: '2026-10-18' } });

    const minutesInput = screen.getByLabelText(/weekly available study time/i) as HTMLInputElement;
    fireEvent.change(minutesInput, { target: { value: '450' } });

    fireEvent.click(screen.getByRole('button', { name: /generate study plan/i }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).not.toBeNull();
      expect(screen.getByText('No eligible subjects or assessments found')).not.toBeNull();
    });

    // Inputs must be preserved
    expect(startInput.value).toBe('2026-10-12');
    expect(endInput.value).toBe('2026-10-18');
    expect(minutesInput.value).toBe('450');
  });

  test('handles HTTP 409 missing active semester error', async () => {
    (api.post as any).mockRejectedValue(
      new (ApiError as any)(409, { detail: 'User has no active semester' })
    );

    render(<GenerateStudyPlanForm activeSemester={mockSemester} />, { wrapper: Wrapper });

    const startInput = screen.getByLabelText(/week start/i);
    fireEvent.change(startInput, { target: { value: '2026-10-12' } });
    const endInput = screen.getByLabelText(/week end/i);
    fireEvent.change(endInput, { target: { value: '2026-10-18' } });

    fireEvent.click(screen.getByRole('button', { name: /generate study plan/i }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).not.toBeNull();
      expect(
        screen.getByText(/no active semester found\. please activate a semester on the semesters page\./i)
      ).not.toBeNull();
    });
  });

  test('handles HTTP 409 existing active study plan error', async () => {
    (api.post as any).mockRejectedValue(
      new (ApiError as any)(409, { detail: 'User already has an active study plan' })
    );

    render(<GenerateStudyPlanForm activeSemester={mockSemester} />, { wrapper: Wrapper });

    const startInput = screen.getByLabelText(/week start/i);
    fireEvent.change(startInput, { target: { value: '2026-10-12' } });
    const endInput = screen.getByLabelText(/week end/i);
    fireEvent.change(endInput, { target: { value: '2026-10-18' } });

    fireEvent.click(screen.getByRole('button', { name: /generate study plan/i }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).not.toBeNull();
      expect(screen.getByText(/an active study plan already exists for your account\./i)).not.toBeNull();
    });
  });

  test('calls onClose when cancel button is clicked', () => {
    const onClose = vi.fn();
    render(<GenerateStudyPlanForm activeSemester={mockSemester} onClose={onClose} />, {
      wrapper: Wrapper,
    });

    const cancelBtn = screen.getAllByRole('button', { name: /cancel/i })[0];
    fireEvent.click(cancelBtn);

    expect(onClose).toHaveBeenCalled();
  });
});
