import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, test, expect, vi, beforeEach } from 'vitest';
import { BrowserRouter, Routes, Route } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import SemesterDetail from './SemesterDetail';
import { api } from '@/api/client';

const { mockApi } = vi.hoisted(() => ({
  mockApi: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
    patch: vi.fn(),
  },
}));

vi.mock('@/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/client')>();
  return {
    ...actual,
    api: mockApi,
    fetchSubjectPattern: vi.fn((subjectId: string) => mockApi.get(`/subjects/${subjectId}/pattern`)),
    subjectPatternQueryOptions: (subjectId: string) => ({
      queryKey: actual.subjectPatternQueryKey(subjectId),
      queryFn: () => mockApi.get(`/subjects/${subjectId}/pattern`),
      enabled: Boolean(subjectId),
    }),
  };
});

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

  test('deletes subject and invalidates queries', async () => {
    (api.get as any).mockImplementation((url: string) => {
      if (url === '/semesters/123') return Promise.resolve({ id: '123', name: 'Fall' });
      if (url === '/semesters/123/subjects') return Promise.resolve([{ id: '1', name: 'Math 101' }]);
      return Promise.resolve(null);
    });
    (api.delete as any).mockResolvedValueOnce({});

    const confirmSpy = vi.spyOn(window, 'confirm').mockImplementation(() => true);
    const invalidateQueriesSpy = vi.spyOn(queryClient, 'invalidateQueries');

    render(<SemesterDetail />, { wrapper: Wrapper });

    await waitFor(() => {
      expect(screen.getByText('Math 101')).not.toBeNull();
    });

    fireEvent.click(screen.getByRole('button', { name: /delete/i }));

    await waitFor(() => {
      expect(api.delete).toHaveBeenCalledWith('/subjects/1');
      expect(invalidateQueriesSpy).toHaveBeenCalledWith({ queryKey: ['semesters', '123', 'subjects'] });
      expect(invalidateQueriesSpy).toHaveBeenCalledWith({ queryKey: ['dashboard'] });
      expect(invalidateQueriesSpy).toHaveBeenCalledWith({ queryKey: ['subjects'] });
    });

    confirmSpy.mockRestore();
    invalidateQueriesSpy.mockRestore();
  });

  test('action button container has relative z-10 positioning and delete click does not navigate', async () => {
    (api.get as any).mockImplementation((url: string) => {
      if (url === '/semesters/123') return Promise.resolve({ id: '123', name: 'Fall' });
      if (url === '/semesters/123/subjects') return Promise.resolve([{ id: '1', name: 'Math 101' }]);
      return Promise.resolve(null);
    });
    (api.delete as any).mockResolvedValueOnce({});

    const confirmSpy = vi.spyOn(window, 'confirm').mockImplementation(() => true);

    render(<SemesterDetail />, { wrapper: Wrapper });

    await waitFor(() => {
      expect(screen.getByText('Math 101')).not.toBeNull();
    });

    const deleteButton = screen.getByRole('button', { name: /delete/i });
    const actionContainer = deleteButton.parentElement;
    expect(actionContainer?.className).toContain('relative');
    expect(actionContainer?.className).toContain('z-10');

    fireEvent.click(deleteButton);

    expect(confirmSpy).toHaveBeenCalledWith('Are you sure you want to delete this subject?');
    await waitFor(() => {
      expect(api.delete).toHaveBeenCalledWith('/subjects/1');
    });
    expect(window.location.pathname).toBe('/app/semesters/123');

    confirmSpy.mockRestore();
  });

  test('does not delete subject when confirmation is cancelled', async () => {
    (api.get as any).mockImplementation((url: string) => {
      if (url === '/semesters/123') return Promise.resolve({ id: '123', name: 'Fall' });
      if (url === '/semesters/123/subjects') return Promise.resolve([{ id: '1', name: 'Math 101' }]);
      return Promise.resolve(null);
    });

    const confirmSpy = vi.spyOn(window, 'confirm').mockImplementation(() => false);

    render(<SemesterDetail />, { wrapper: Wrapper });

    await waitFor(() => {
      expect(screen.getByText('Math 101')).not.toBeNull();
    });

    fireEvent.click(screen.getByRole('button', { name: /delete/i }));

    expect(confirmSpy).toHaveBeenCalled();
    expect(api.delete).not.toHaveBeenCalled();

    confirmSpy.mockRestore();
  });

  describe('Semester Date Editing', () => {
    test('opens edit semester modal and updates semester dates', async () => {
      (api.get as any).mockImplementation((url: string) => {
        if (url === '/semesters/123') {
          return Promise.resolve({
            id: '123',
            name: 'Fall 2026',
            academic_year: '2026',
            start_date: '2026-08-01',
            end_date: '2026-12-15',
          });
        }
        if (url === '/semesters/123/subjects') return Promise.resolve([]);
        return Promise.resolve(null);
      });
      (api.put as any).mockResolvedValueOnce({
        id: '123',
        name: 'Fall 2026 Updated',
        academic_year: '2026-2027',
        start_date: '2026-08-15',
        end_date: '2026-12-20',
      });

      render(<SemesterDetail />, { wrapper: Wrapper });

      await waitFor(() => {
        expect(screen.getByText('Fall 2026')).not.toBeNull();
        expect(screen.getByText(/Dates: 2026-08-01 – 2026-12-15/i)).not.toBeNull();
      });

      fireEvent.click(screen.getByRole('button', { name: /edit semester/i }));

      await waitFor(() => {
        expect(screen.getByRole('heading', { name: 'Edit Semester' })).not.toBeNull();
      });

      const startDateInput = screen.getByLabelText(/start date/i);
      const endDateInput = screen.getByLabelText(/end date/i);

      expect((startDateInput as HTMLInputElement).value).toBe('2026-08-01');
      expect((endDateInput as HTMLInputElement).value).toBe('2026-12-15');

      fireEvent.change(startDateInput, { target: { value: '2026-08-15' } });
      fireEvent.change(endDateInput, { target: { value: '2026-12-20' } });

      fireEvent.click(screen.getByRole('button', { name: /save changes/i }));

      await waitFor(() => {
        expect(api.put).toHaveBeenCalledWith('/semesters/123', {
          name: 'Fall 2026',
          academic_year: '2026',
          start_date: '2026-08-15',
          end_date: '2026-12-20',
        });
      });
    });

    test('semester date update invalidates all four query keys', async () => {
      (api.get as any).mockImplementation((url: string) => {
        if (url === '/semesters/123') {
          return Promise.resolve({
            id: '123',
            name: 'Fall 2026',
            academic_year: '2026',
            start_date: '2026-08-01',
            end_date: '2026-12-15',
          });
        }
        if (url === '/semesters/123/subjects') return Promise.resolve([]);
        return Promise.resolve(null);
      });
      (api.put as any).mockResolvedValueOnce({
        id: '123',
        name: 'Fall 2026',
        academic_year: '2026',
        start_date: '2026-08-10',
        end_date: '2026-12-20',
      });

      const invalidateQueriesSpy = vi.spyOn(queryClient, 'invalidateQueries');

      render(<SemesterDetail />, { wrapper: Wrapper });

      await waitFor(() => {
        expect(screen.getByText('Fall 2026')).not.toBeNull();
      });

      fireEvent.click(screen.getByRole('button', { name: /edit semester/i }));

      await waitFor(() => {
        expect(screen.getByRole('heading', { name: 'Edit Semester' })).not.toBeNull();
      });

      fireEvent.change(screen.getByLabelText(/start date/i), { target: { value: '2026-08-10' } });
      fireEvent.click(screen.getByRole('button', { name: /save changes/i }));

      await waitFor(() => {
        expect(invalidateQueriesSpy).toHaveBeenCalledWith({ queryKey: ['semesters', '123'] });
        expect(invalidateQueriesSpy).toHaveBeenCalledWith({ queryKey: ['semesters', '123', 'lectures'] });
        expect(invalidateQueriesSpy).toHaveBeenCalledWith({ queryKey: ['semesters'] });
        expect(invalidateQueriesSpy).toHaveBeenCalledWith({ queryKey: ['dashboard'] });
      });

      invalidateQueriesSpy.mockRestore();
    });

    test('validates end date cannot be before start date in edit modal', async () => {
      (api.get as any).mockImplementation((url: string) => {
        if (url === '/semesters/123') {
          return Promise.resolve({
            id: '123',
            name: 'Fall 2026',
            academic_year: '2026',
            start_date: '2026-08-01',
            end_date: '2026-12-15',
          });
        }
        return Promise.resolve([]);
      });

      render(<SemesterDetail />, { wrapper: Wrapper });

      await waitFor(() => {
        expect(screen.getByText('Fall 2026')).not.toBeNull();
      });

      fireEvent.click(screen.getByRole('button', { name: /edit semester/i }));

      await waitFor(() => {
        expect(screen.getByRole('heading', { name: 'Edit Semester' })).not.toBeNull();
      });

      const startDateInput = screen.getByLabelText(/start date/i);
      const endDateInput = screen.getByLabelText(/end date/i);

      fireEvent.change(startDateInput, { target: { value: '2026-12-20' } });
      fireEvent.change(endDateInput, { target: { value: '2026-08-01' } });

      fireEvent.click(screen.getByRole('button', { name: /save changes/i }));

      await waitFor(() => {
        expect(screen.getByText(/end date cannot be before start date/i)).not.toBeNull();
      });

      expect(api.put).not.toHaveBeenCalled();
    });

    test('allows clearing optional dates in edit modal', async () => {
      (api.get as any).mockImplementation((url: string) => {
        if (url === '/semesters/123') {
          return Promise.resolve({
            id: '123',
            name: 'Fall 2026',
            academic_year: '2026',
            start_date: '2026-08-01',
            end_date: '2026-12-15',
          });
        }
        return Promise.resolve([]);
      });
      (api.put as any).mockResolvedValueOnce({
        id: '123',
        name: 'Fall 2026',
        academic_year: '2026',
        start_date: null,
        end_date: null,
      });

      render(<SemesterDetail />, { wrapper: Wrapper });

      await waitFor(() => {
        expect(screen.getByText('Fall 2026')).not.toBeNull();
      });

      fireEvent.click(screen.getByRole('button', { name: /edit semester/i }));

      await waitFor(() => {
        expect(screen.getByRole('heading', { name: 'Edit Semester' })).not.toBeNull();
      });

      fireEvent.change(screen.getByLabelText(/start date/i), { target: { value: '' } });
      fireEvent.change(screen.getByLabelText(/end date/i), { target: { value: '' } });

      fireEvent.click(screen.getByRole('button', { name: /save changes/i }));

      await waitFor(() => {
        expect(api.put).toHaveBeenCalledWith('/semesters/123', {
          name: 'Fall 2026',
          academic_year: '2026',
          start_date: null,
          end_date: null,
        });
      });
    });
  });

  describe('Weekly Timetable Management', () => {
    test('switches to weekly timetable tab and displays empty state', async () => {
      (api.get as any).mockImplementation((url: string) => {
        if (url === '/semesters/123') {
          return Promise.resolve({ id: '123', name: 'Fall 2026', academic_year: '2026' });
        }
        if (url === '/semesters/123/subjects') {
          return Promise.resolve([{ id: 'sub-1', name: 'Algorithms', code: 'CS301' }]);
        }
        if (url === '/semesters/123/timetable') {
          return Promise.resolve([]);
        }
        return Promise.resolve(null);
      });

      render(<SemesterDetail />, { wrapper: Wrapper });

      await waitFor(() => {
        expect(screen.getByText('Fall 2026')).not.toBeNull();
      });

      fireEvent.click(screen.getByRole('button', { name: /weekly timetable/i }));

      await waitFor(() => {
        expect(screen.getByRole('heading', { name: 'Weekly Timetable' })).not.toBeNull();
        expect(screen.getByText('No timetable slots configured')).not.toBeNull();
      });
    });

    test('displays weekly timetable slots grouped by day of week', async () => {
      (api.get as any).mockImplementation((url: string) => {
        if (url === '/semesters/123') {
          return Promise.resolve({ id: '123', name: 'Fall 2026', academic_year: '2026' });
        }
        if (url === '/semesters/123/subjects') {
          return Promise.resolve([{ id: 'sub-1', name: 'Algorithms', code: 'CS301' }]);
        }
        if (url === '/semesters/123/timetable') {
          return Promise.resolve([
            {
              id: 'slot-1',
              semester_id: '123',
              subject_id: 'sub-1',
              day_of_week: 0,
              start_time: '09:00:00',
              end_time: '10:30:00',
              effective_from: '2026-08-01',
              effective_to: null,
              is_active: true,
            },
          ]);
        }
        return Promise.resolve(null);
      });

      render(<SemesterDetail />, { wrapper: Wrapper });

      await waitFor(() => {
        expect(screen.getByText('Fall 2026')).not.toBeNull();
      });

      fireEvent.click(screen.getByRole('button', { name: /weekly timetable/i }));

      await waitFor(() => {
        expect(screen.getByText('Algorithms')).not.toBeNull();
        expect(screen.getByText('CS301')).not.toBeNull();
        expect(screen.getByText(/09:00 – 10:30/i)).not.toBeNull();
        expect(screen.getByText(/From 2026-08-01/i)).not.toBeNull();
        expect(screen.getByText('1 class')).not.toBeNull();
      });
    });

    test('creates new timetable slot with validation', async () => {
      (api.get as any).mockImplementation((url: string) => {
        if (url === '/semesters/123') {
          return Promise.resolve({
            id: '123',
            name: 'Fall 2026',
            academic_year: '2026',
            start_date: '2026-08-01',
            end_date: '2026-12-15',
          });
        }
        if (url === '/semesters/123/subjects') {
          return Promise.resolve([{ id: 'sub-1', name: 'Algorithms', code: 'CS301' }]);
        }
        if (url === '/semesters/123/timetable') {
          return Promise.resolve([]);
        }
        return Promise.resolve(null);
      });
      (api.post as any).mockResolvedValueOnce({
        id: 'slot-new',
        semester_id: '123',
        subject_id: 'sub-1',
        day_of_week: 1,
        start_time: '11:00:00',
        end_time: '12:30:00',
        effective_from: '2026-08-01',
        effective_to: '2026-12-15',
        is_active: true,
      });

      render(<SemesterDetail />, { wrapper: Wrapper });

      await waitFor(() => {
        expect(screen.getByText('Fall 2026')).not.toBeNull();
      });

      fireEvent.click(screen.getByRole('button', { name: /weekly timetable/i }));

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /add lecture slot/i })).not.toBeNull();
      });

      fireEvent.click(screen.getByRole('button', { name: /add lecture slot/i }));

      await waitFor(() => {
        expect(screen.getByRole('heading', { name: 'Add Weekly Lecture Slot' })).not.toBeNull();
      });

      // Change day to Tuesday (value 1)
      fireEvent.change(screen.getByLabelText(/day of the week \*/i), { target: { value: '1' } });
      fireEvent.change(screen.getByLabelText(/start time \*/i), { target: { value: '11:00' } });
      fireEvent.change(screen.getByLabelText(/end time \*/i), { target: { value: '12:30' } });

      fireEvent.click(screen.getByRole('button', { name: 'Add Slot' }));

      await waitFor(() => {
        expect(api.post).toHaveBeenCalledWith('/semesters/123/timetable', {
          subject_id: 'sub-1',
          day_of_week: 1,
          start_time: '11:00:00',
          end_time: '12:30:00',
          effective_from: '2026-08-01',
          effective_to: '2026-12-15',
        });
      });
    });

    test('validates start time must be before end time in slot form', async () => {
      (api.get as any).mockImplementation((url: string) => {
        if (url === '/semesters/123') {
          return Promise.resolve({ id: '123', name: 'Fall 2026', academic_year: '2026' });
        }
        if (url === '/semesters/123/subjects') {
          return Promise.resolve([{ id: 'sub-1', name: 'Algorithms' }]);
        }
        if (url === '/semesters/123/timetable') {
          return Promise.resolve([]);
        }
        return Promise.resolve(null);
      });

      render(<SemesterDetail />, { wrapper: Wrapper });

      await waitFor(() => {
        expect(screen.getByText('Fall 2026')).not.toBeNull();
      });

      fireEvent.click(screen.getByRole('button', { name: /weekly timetable/i }));

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /add lecture slot/i })).not.toBeNull();
      });

      fireEvent.click(screen.getByRole('button', { name: /add lecture slot/i }));

      // Set start time after end time
      fireEvent.change(screen.getByLabelText(/start time \*/i), { target: { value: '14:00' } });
      fireEvent.change(screen.getByLabelText(/end time \*/i), { target: { value: '13:00' } });

      fireEvent.click(screen.getByRole('button', { name: 'Add Slot' }));

      await waitFor(() => {
        expect(screen.getByText(/start time must be before end time/i)).not.toBeNull();
      });

      expect(api.post).not.toHaveBeenCalled();
    });

    test('deletes timetable slot after confirmation', async () => {
      (api.get as any).mockImplementation((url: string) => {
        if (url === '/semesters/123') {
          return Promise.resolve({ id: '123', name: 'Fall 2026', academic_year: '2026' });
        }
        if (url === '/semesters/123/subjects') {
          return Promise.resolve([{ id: 'sub-1', name: 'Algorithms' }]);
        }
        if (url === '/semesters/123/timetable') {
          return Promise.resolve([
            {
              id: 'slot-1',
              semester_id: '123',
              subject_id: 'sub-1',
              day_of_week: 0,
              start_time: '09:00:00',
              end_time: '10:30:00',
              effective_from: '2026-08-01',
              effective_to: null,
              is_active: true,
            },
          ]);
        }
        return Promise.resolve(null);
      });
      (api.delete as any).mockResolvedValueOnce({});

      const confirmSpy = vi.spyOn(window, 'confirm').mockImplementation(() => true);

      render(<SemesterDetail />, { wrapper: Wrapper });

      await waitFor(() => {
        expect(screen.getByText('Fall 2026')).not.toBeNull();
      });

      fireEvent.click(screen.getByRole('button', { name: /weekly timetable/i }));

      await waitFor(() => {
        expect(screen.getByLabelText('Delete slot')).not.toBeNull();
      });

      fireEvent.click(screen.getByLabelText('Delete slot'));

      expect(confirmSpy).toHaveBeenCalledWith(
        'Are you sure you want to delete this weekly timetable slot? Historical attendance will be preserved.'
      );

      await waitFor(() => {
        expect(api.delete).toHaveBeenCalledWith('/semesters/123/timetable/slot-1');
      });

      confirmSpy.mockRestore();
    });

    test('switching to edit mode clears stale validation errors', async () => {
      (api.get as any).mockImplementation((url: string) => {
        if (url === '/semesters/123') return Promise.resolve({ id: '123', name: 'Fall 2026', academic_year: '2026' });
        if (url === '/semesters/123/subjects') return Promise.resolve([{ id: 'sub-1', name: 'Algorithms' }]);
        if (url === '/semesters/123/timetable') {
          return Promise.resolve([
            {
              id: 'slot-1',
              semester_id: '123',
              subject_id: 'sub-1',
              day_of_week: 0,
              start_time: '09:00:00',
              end_time: '10:30:00',
              effective_from: '2026-08-01',
              effective_to: null,
              is_active: true,
            },
          ]);
        }
        return Promise.resolve(null);
      });

      render(<SemesterDetail />, { wrapper: Wrapper });

      await waitFor(() => {
        expect(screen.getByText('Fall 2026')).not.toBeNull();
      });

      fireEvent.click(screen.getByRole('button', { name: /weekly timetable/i }));

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /add lecture slot/i })).not.toBeNull();
      });

      // 1. Open create form and induce a validation error
      fireEvent.click(screen.getByRole('button', { name: /add lecture slot/i }));
      fireEvent.change(screen.getByLabelText(/start time \*/i), { target: { value: '14:00' } });
      fireEvent.change(screen.getByLabelText(/end time \*/i), { target: { value: '13:00' } });
      fireEvent.click(screen.getByRole('button', { name: 'Add Slot' }));

      await waitFor(() => {
        expect(screen.getByText(/start time must be before end time/i)).not.toBeNull();
      });

      // 2. Switch directly to editing existing slot without cancelling
      fireEvent.click(screen.getByLabelText('Edit slot'));

      await waitFor(() => {
        expect(screen.getByRole('heading', { name: 'Edit Timetable Slot' })).not.toBeNull();
      });

      // Stale validation error should be cleared
      expect(screen.queryByText(/start time must be before end time/i)).toBeNull();
    });

    test('updates existing timetable slot via PUT', async () => {
      (api.get as any).mockImplementation((url: string) => {
        if (url === '/semesters/123') return Promise.resolve({ id: '123', name: 'Fall 2026', academic_year: '2026' });
        if (url === '/semesters/123/subjects') return Promise.resolve([{ id: 'sub-1', name: 'Algorithms' }]);
        if (url === '/semesters/123/timetable') {
          return Promise.resolve([
            {
              id: 'slot-1',
              semester_id: '123',
              subject_id: 'sub-1',
              day_of_week: 0,
              start_time: '09:00:00',
              end_time: '10:30:00',
              effective_from: '2026-08-01',
              effective_to: null,
              is_active: true,
            },
          ]);
        }
        return Promise.resolve(null);
      });
      (api.put as any).mockResolvedValueOnce({
        id: 'slot-1',
        semester_id: '123',
        subject_id: 'sub-1',
        day_of_week: 2,
        start_time: '10:00:00',
        end_time: '11:30:00',
        effective_from: '2026-08-01',
        effective_to: null,
      });

      render(<SemesterDetail />, { wrapper: Wrapper });

      await waitFor(() => {
        expect(screen.getByText('Fall 2026')).not.toBeNull();
      });

      fireEvent.click(screen.getByRole('button', { name: /weekly timetable/i }));

      await waitFor(() => {
        expect(screen.getByLabelText('Edit slot')).not.toBeNull();
      });

      fireEvent.click(screen.getByLabelText('Edit slot'));

      await waitFor(() => {
        expect(screen.getByRole('heading', { name: 'Edit Timetable Slot' })).not.toBeNull();
      });

      // Subject select should be disabled in edit mode
      expect(screen.getByLabelText(/subject \*/i)).toBeDisabled();

      // Change day to Wednesday (value 2) and update times
      fireEvent.change(screen.getByLabelText(/day of the week \*/i), { target: { value: '2' } });
      fireEvent.change(screen.getByLabelText(/start time \*/i), { target: { value: '10:00' } });
      fireEvent.change(screen.getByLabelText(/end time \*/i), { target: { value: '11:30' } });

      fireEvent.click(screen.getByRole('button', { name: 'Update Slot' }));

      await waitFor(() => {
        expect(api.put).toHaveBeenCalledWith('/semesters/123/timetable/slot-1', {
          day_of_week: 2,
          start_time: '10:00:00',
          end_time: '11:30:00',
          effective_from: '2026-08-01',
          effective_to: null,
        });
      });
    });

    test('validates effective date range ordering and semester boundaries', async () => {
      (api.get as any).mockImplementation((url: string) => {
        if (url === '/semesters/123') {
          return Promise.resolve({
            id: '123',
            name: 'Fall 2026',
            academic_year: '2026',
            start_date: '2026-08-01',
            end_date: '2026-12-15',
          });
        }
        if (url === '/semesters/123/subjects') return Promise.resolve([{ id: 'sub-1', name: 'Algorithms' }]);
        if (url === '/semesters/123/timetable') return Promise.resolve([]);
        return Promise.resolve(null);
      });

      render(<SemesterDetail />, { wrapper: Wrapper });

      await waitFor(() => {
        expect(screen.getByText('Fall 2026')).not.toBeNull();
      });

      fireEvent.click(screen.getByRole('button', { name: /weekly timetable/i }));

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /add lecture slot/i })).not.toBeNull();
      });

      fireEvent.click(screen.getByRole('button', { name: /add lecture slot/i }));

      // 1. Effective date order: effective_from > effective_to
      fireEvent.change(screen.getByLabelText(/effective from \*/i), { target: { value: '2026-10-01' } });
      fireEvent.change(screen.getByLabelText(/effective to/i), { target: { value: '2026-09-01' } });
      fireEvent.click(screen.getByRole('button', { name: 'Add Slot' }));

      await waitFor(() => {
        expect(screen.getByText(/effective-from date cannot be after effective-to date/i)).not.toBeNull();
      });

      // 2. Semester boundary: effective_to < semester.start_date
      fireEvent.change(screen.getByLabelText(/effective from \*/i), { target: { value: '2026-07-01' } });
      fireEvent.change(screen.getByLabelText(/effective to/i), { target: { value: '2026-07-20' } });
      fireEvent.click(screen.getByRole('button', { name: 'Add Slot' }));

      await waitFor(() => {
        expect(screen.getByText(/slot effective_to cannot be before semester start date \(2026-08-01\)/i)).not.toBeNull();
      });

      // 3. Semester boundary: effective_from > semester.end_date
      fireEvent.change(screen.getByLabelText(/effective from \*/i), { target: { value: '2026-12-20' } });
      fireEvent.change(screen.getByLabelText(/effective to/i), { target: { value: '' } });
      fireEvent.click(screen.getByRole('button', { name: 'Add Slot' }));

      await waitFor(() => {
        expect(screen.getByText(/slot effective_from cannot be after semester end date \(2026-12-15\)/i)).not.toBeNull();
      });

      expect(api.post).not.toHaveBeenCalled();
    });
  });

  describe('Academic Calendar Integration (Phase 3.2)', () => {
    test('switches to academic calendar tab and displays empty state', async () => {
      (api.get as any).mockImplementation((url: string) => {
        if (url === '/semesters/123') {
          return Promise.resolve({
            id: '123',
            name: 'Fall 2026',
            academic_year: '2026',
            start_date: '2026-08-01',
            end_date: '2026-12-15',
          });
        }
        if (url === '/semesters/123/subjects') {
          return Promise.resolve([{ id: 'sub-1', name: 'Algorithms', code: 'CS301' }]);
        }
        if (url === '/semesters/123/calendar') {
          return Promise.resolve([]);
        }
        return Promise.resolve(null);
      });

      render(<SemesterDetail />, { wrapper: Wrapper });

      await waitFor(() => {
        expect(screen.getByText('Fall 2026')).not.toBeNull();
      });

      // Academic Calendar tab button is present
      const calendarTabBtn = screen.getByRole('button', { name: /academic calendar/i });
      expect(calendarTabBtn).toBeInTheDocument();

      fireEvent.click(calendarTabBtn);

      await waitFor(() => {
        expect(screen.getByRole('heading', { name: 'Academic Calendar' })).toBeInTheDocument();
        expect(screen.getByText('No calendar events configured')).toBeInTheDocument();
      });
    });

    test('displays calendar events with linked assessments badge only when assessment_ids is present', async () => {
      (api.get as any).mockImplementation((url: string) => {
        if (url === '/semesters/123') {
          return Promise.resolve({
            id: '123',
            name: 'Fall 2026',
            academic_year: '2026',
            start_date: '2026-08-01',
            end_date: '2026-12-15',
          });
        }
        if (url === '/semesters/123/subjects') {
          return Promise.resolve([{ id: 'sub-1', name: 'Algorithms', code: 'CS301' }]);
        }
        if (url === '/semesters/123/calendar') {
          return Promise.resolve([
            {
              id: 'ev-1',
              semester_id: '123',
              title: 'Midterm Exam Week',
              event_type: 'exam',
              start_date: '2026-10-10',
              end_date: '2026-10-15',
              cancels_regular_classes: false,
              subject_ids: ['sub-1'],
              assessment_ids: ['ass-1', 'ass-2'],
              created_at: '2026-08-01T00:00:00Z',
              updated_at: null,
            },
            {
              id: 'ev-2',
              semester_id: '123',
              title: 'National Holiday',
              event_type: 'holiday',
              start_date: '2026-11-01',
              end_date: '2026-11-01',
              cancels_regular_classes: true,
              subject_ids: [],
              assessment_ids: [],
              created_at: '2026-08-01T00:00:00Z',
              updated_at: null,
            },
            {
              id: 'ev-3',
              semester_id: '123',
              title: 'Quiz Day',
              event_type: 'exam',
              start_date: '2026-10-25',
              end_date: '2026-10-25',
              cancels_regular_classes: false,
              subject_ids: ['sub-1'],
              assessment_ids: ['ass-single'],
              created_at: '2026-08-01T00:00:00Z',
              updated_at: null,
            },
            {
              id: 'ev-4',
              semester_id: '123',
              title: 'Undated Break',
              event_type: 'non_working_day',
              start_date: '2026-11-15',
              end_date: '2026-11-15',
              cancels_regular_classes: true,
              subject_ids: [],
              created_at: '2026-08-01T00:00:00Z',
              updated_at: null,
            },
          ]);
        }
        return Promise.resolve(null);
      });

      render(<SemesterDetail />, { wrapper: Wrapper });

      await waitFor(() => {
        expect(screen.getByText('Fall 2026')).not.toBeNull();
      });

      fireEvent.click(screen.getByRole('button', { name: /academic calendar/i }));

      await waitFor(() => {
        expect(screen.getByText('Midterm Exam Week')).toBeInTheDocument();
        expect(screen.getByText('National Holiday')).toBeInTheDocument();
        expect(screen.getByText('Quiz Day')).toBeInTheDocument();
        expect(screen.getByText('Undated Break')).toBeInTheDocument();
      });

      // Plural badge
      expect(screen.getByText('2 linked assessments')).toBeInTheDocument();

      // Singular badge
      expect(screen.getByText('1 linked assessment')).toBeInTheDocument();

      // Holiday (empty assessment_ids) and Undated Break (missing assessment_ids) do not render badge
      expect(screen.queryByText(/0 linked assessments/i)).not.toBeInTheDocument();
    });

    test('renders loading state and handles API fetch error with visible alert', async () => {
      (api.get as any).mockImplementation((url: string) => {
        if (url === '/semesters/123') return Promise.resolve({ id: '123', name: 'Fall 2026' });
        if (url === '/semesters/123/subjects') return Promise.resolve([]);
        if (url === '/semesters/123/calendar') {
          return Promise.reject(new Error('Network failure'));
        }
        return Promise.resolve(null);
      });

      render(<SemesterDetail />, { wrapper: Wrapper });
      await waitFor(() => expect(screen.getByText('Fall 2026')).not.toBeNull());

      fireEvent.click(screen.getByRole('button', { name: /academic calendar/i }));

      await waitFor(() => {
        expect(screen.getByText('Failed to load calendar events.')).toBeInTheDocument();
      });
    });

    test('creates a holiday with default class cancellation and invalidates query keys', async () => {
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
      (api.get as any).mockImplementation((url: string) => {
        if (url === '/semesters/123') return Promise.resolve({ id: '123', name: 'Fall 2026' });
        if (url === '/semesters/123/subjects') return Promise.resolve([]);
        if (url === '/semesters/123/calendar') return Promise.resolve([]);
        return Promise.resolve(null);
      });
      (api.post as any).mockResolvedValue({
        id: 'ev-new',
        semester_id: '123',
        title: 'Labor Day',
        event_type: 'holiday',
        start_date: '2026-09-07',
        end_date: '2026-09-07',
        cancels_regular_classes: true,
        subject_ids: [],
        created_at: '2026-08-01T00:00:00Z',
        updated_at: null,
      });

      render(<SemesterDetail />, { wrapper: Wrapper });
      await waitFor(() => expect(screen.getByText('Fall 2026')).not.toBeNull());

      fireEvent.click(screen.getByRole('button', { name: /academic calendar/i }));
      await waitFor(() => expect(screen.getByRole('button', { name: /add calendar event/i })).toBeInTheDocument());

      fireEvent.click(screen.getByRole('button', { name: /add calendar event/i }));

      // Check default values: holiday & cancels_regular_classes checked
      expect(screen.getByLabelText(/event type \*/i)).toHaveValue('holiday');
      const cancelsCheckbox = screen.getByLabelText(/cancels regular timetable lectures during this period/i);
      expect(cancelsCheckbox).toBeChecked();

      fireEvent.change(screen.getByLabelText(/event title \*/i), { target: { value: 'Labor Day' } });
      fireEvent.change(screen.getByLabelText(/start date \*/i), { target: { value: '2026-09-07' } });
      fireEvent.change(screen.getByLabelText(/end date \*/i), { target: { value: '2026-09-07' } });

      fireEvent.click(screen.getByRole('button', { name: 'Add Event' }));

      await waitFor(() => {
        expect(api.post).toHaveBeenCalledWith('/semesters/123/calendar', {
          title: 'Labor Day',
          event_type: 'holiday',
          start_date: '2026-09-07',
          end_date: '2026-09-07',
          cancels_regular_classes: true,
          subject_ids: [],
        });
      });

      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['semesters', '123', 'calendar'] });
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['semesters', '123', 'lectures'] });
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['dashboard'] });
      invalidateSpy.mockRestore();
    });

    test('creates a non-working day event', async () => {
      (api.get as any).mockImplementation((url: string) => {
        if (url === '/semesters/123') return Promise.resolve({ id: '123', name: 'Fall 2026' });
        if (url === '/semesters/123/subjects') return Promise.resolve([]);
        if (url === '/semesters/123/calendar') return Promise.resolve([]);
        return Promise.resolve(null);
      });
      (api.post as any).mockResolvedValue({ id: 'ev-nwd' });

      render(<SemesterDetail />, { wrapper: Wrapper });
      await waitFor(() => expect(screen.getByText('Fall 2026')).not.toBeNull());

      fireEvent.click(screen.getByRole('button', { name: /academic calendar/i }));
      await waitFor(() => expect(screen.getByRole('button', { name: /add calendar event/i })).toBeInTheDocument());

      fireEvent.click(screen.getByRole('button', { name: /add calendar event/i }));

      fireEvent.change(screen.getByLabelText(/event title \*/i), { target: { value: 'Reading Period' } });
      fireEvent.change(screen.getByLabelText(/event type \*/i), { target: { value: 'non_working_day' } });
      fireEvent.change(screen.getByLabelText(/start date \*/i), { target: { value: '2026-10-01' } });
      fireEvent.change(screen.getByLabelText(/end date \*/i), { target: { value: '2026-10-02' } });

      fireEvent.click(screen.getByRole('button', { name: 'Add Event' }));

      await waitFor(() => {
        expect(api.post).toHaveBeenCalledWith('/semesters/123/calendar', {
          title: 'Reading Period',
          event_type: 'non_working_day',
          start_date: '2026-10-01',
          end_date: '2026-10-02',
          cancels_regular_classes: true,
          subject_ids: [],
        });
      });
    });

    test('creates an exam event with multiple subject associations and unchecks class cancellation by default', async () => {
      (api.get as any).mockImplementation((url: string) => {
        if (url === '/semesters/123') return Promise.resolve({ id: '123', name: 'Fall 2026' });
        if (url === '/semesters/123/subjects') {
          return Promise.resolve([
            { id: 'sub-1', name: 'Algorithms', code: 'CS301' },
            { id: 'sub-2', name: 'Databases', code: 'CS302' },
          ]);
        }
        if (url === '/subjects/sub-1/pattern') {
          return Promise.resolve({
            id: 'pat-1',
            subject_id: 'sub-1',
            is_active: true,
            components: [
              { id: 'comp-1', name: 'Midterm', category: 'exam', weightage: 30, max_marks: 100, is_active: true, order: 1 },
            ],
          });
        }
        if (url === '/subjects/sub-2/pattern') {
          return Promise.resolve({
            id: 'pat-2',
            subject_id: 'sub-2',
            is_active: true,
            components: [
              { id: 'comp-2', name: 'Final Exam', category: 'exam', weightage: 40, max_marks: 100, is_active: true, order: 2 },
            ],
          });
        }
        if (url === '/semesters/123/calendar') return Promise.resolve([]);
        return Promise.resolve(null);
      });
      (api.post as any).mockResolvedValue({ id: 'ev-exam' });

      render(<SemesterDetail />, { wrapper: Wrapper });
      await waitFor(() => expect(screen.getByText('Fall 2026')).not.toBeNull());

      fireEvent.click(screen.getByRole('button', { name: /academic calendar/i }));
      await waitFor(() => expect(screen.getByRole('button', { name: /add calendar event/i })).toBeInTheDocument());

      fireEvent.click(screen.getByRole('button', { name: /add calendar event/i }));

      fireEvent.change(screen.getByLabelText(/event title \*/i), { target: { value: 'Midterm Exams' } });
      fireEvent.change(screen.getByLabelText(/event type \*/i), { target: { value: 'exam' } });

      // Verifies cancels_regular_classes was automatically unchecked for exam
      const cancelsCheckbox = screen.getByLabelText(/cancels regular timetable lectures during this period/i);
      expect(cancelsCheckbox).not.toBeChecked();

      // Check both subjects
      const algCheckbox = screen.getByLabelText(/Algorithms \(CS301\)/i);
      const dbCheckbox = screen.getByLabelText(/Databases \(CS302\)/i);
      expect(algCheckbox).toBeInTheDocument();
      expect(dbCheckbox).toBeInTheDocument();

      await waitFor(() => {
        expect(algCheckbox).not.toBeDisabled();
        expect(dbCheckbox).not.toBeDisabled();
      });

      fireEvent.click(algCheckbox);
      fireEvent.click(dbCheckbox);

      const algSelect = screen.getByLabelText(/assessment component for algorithms/i);
      const dbSelect = screen.getByLabelText(/assessment component for databases/i);
      fireEvent.change(algSelect, { target: { value: 'comp-1' } });
      fireEvent.change(dbSelect, { target: { value: 'comp-2' } });

      fireEvent.change(screen.getByLabelText(/start date \*/i), { target: { value: '2026-10-12' } });
      fireEvent.change(screen.getByLabelText(/end date \*/i), { target: { value: '2026-10-16' } });

      fireEvent.click(screen.getByRole('button', { name: 'Add Event' }));

      await waitFor(() => {
        expect(api.post).toHaveBeenCalledWith('/semesters/123/calendar', {
          title: 'Midterm Exams',
          event_type: 'exam',
          start_date: '2026-10-12',
          end_date: '2026-10-16',
          cancels_regular_classes: false,
          subject_ids: ['sub-1', 'sub-2'],
          subject_components: [
            { subject_id: 'sub-1', pattern_component_id: 'comp-1' },
            { subject_id: 'sub-2', pattern_component_id: 'comp-2' },
          ],
        });
      });
    });

    test('switching away from exam type clears subject associations', async () => {
      (api.get as any).mockImplementation((url: string) => {
        if (url === '/semesters/123') return Promise.resolve({ id: '123', name: 'Fall 2026' });
        if (url === '/semesters/123/subjects') {
          return Promise.resolve([{ id: 'sub-1', name: 'Algorithms', code: 'CS301' }]);
        }
        if (url === '/semesters/123/calendar') return Promise.resolve([]);
        return Promise.resolve(null);
      });
      (api.post as any).mockResolvedValue({ id: 'ev-holiday' });

      render(<SemesterDetail />, { wrapper: Wrapper });
      await waitFor(() => expect(screen.getByText('Fall 2026')).not.toBeNull());

      fireEvent.click(screen.getByRole('button', { name: /academic calendar/i }));
      await waitFor(() => expect(screen.getByRole('button', { name: /add calendar event/i })).toBeInTheDocument());

      fireEvent.click(screen.getByRole('button', { name: /add calendar event/i }));

      // Select exam first and pick subject
      fireEvent.change(screen.getByLabelText(/event type \*/i), { target: { value: 'exam' } });
      const algCheckbox = screen.getByLabelText(/Algorithms \(CS301\)/i);
      fireEvent.click(algCheckbox);

      // Now switch away to holiday
      fireEvent.change(screen.getByLabelText(/event type \*/i), { target: { value: 'holiday' } });

      fireEvent.change(screen.getByLabelText(/event title \*/i), { target: { value: 'Winter Holiday' } });
      fireEvent.change(screen.getByLabelText(/start date \*/i), { target: { value: '2026-12-24' } });
      fireEvent.change(screen.getByLabelText(/end date \*/i), { target: { value: '2026-12-25' } });

      fireEvent.click(screen.getByRole('button', { name: 'Add Event' }));

      await waitFor(() => {
        expect(api.post).toHaveBeenCalledWith('/semesters/123/calendar', {
          title: 'Winter Holiday',
          event_type: 'holiday',
          start_date: '2026-12-24',
          end_date: '2026-12-25',
          cancels_regular_classes: true,
          subject_ids: [],
        });
      });
    });

    test('edits an existing calendar event using PUT and supports form cancellation', async () => {
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
      (api.get as any).mockImplementation((url: string) => {
        if (url === '/semesters/123') return Promise.resolve({ id: '123', name: 'Fall 2026' });
        if (url === '/semesters/123/subjects') return Promise.resolve([]);
        if (url === '/semesters/123/calendar') {
          return Promise.resolve([
            {
              id: 'ev-1',
              semester_id: '123',
              title: 'Original Break',
              event_type: 'holiday',
              start_date: '2026-11-20',
              end_date: '2026-11-22',
              cancels_regular_classes: true,
              subject_ids: [],
              created_at: '2026-08-01T00:00:00Z',
              updated_at: null,
            },
          ]);
        }
        return Promise.resolve(null);
      });
      (api.put as any).mockResolvedValue({ id: 'ev-1' });

      render(<SemesterDetail />, { wrapper: Wrapper });
      await waitFor(() => expect(screen.getByText('Fall 2026')).not.toBeNull());

      fireEvent.click(screen.getByRole('button', { name: /academic calendar/i }));
      await waitFor(() => expect(screen.getByText('Original Break')).toBeInTheDocument());

      // Start edit
      fireEvent.click(screen.getByRole('button', { name: /edit event/i }));

      // Form heading reflects edit mode
      expect(screen.getByRole('heading', { name: 'Edit Calendar Event' })).toBeInTheDocument();
      const titleInput = screen.getByLabelText(/event title \*/i);
      expect(titleInput).toHaveValue('Original Break');

      // Test cancel button
      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
      expect(screen.queryByRole('heading', { name: 'Edit Calendar Event' })).not.toBeInTheDocument();

      // Start edit again and submit update
      fireEvent.click(screen.getByRole('button', { name: /edit event/i }));
      fireEvent.change(screen.getByLabelText(/event title \*/i), { target: { value: 'Extended Break' } });
      fireEvent.change(screen.getByLabelText(/end date \*/i), { target: { value: '2026-11-25' } });

      fireEvent.click(screen.getByRole('button', { name: 'Update Event' }));

      await waitFor(() => {
        expect(api.put).toHaveBeenCalledWith('/semesters/123/calendar/ev-1', {
          title: 'Extended Break',
          event_type: 'holiday',
          start_date: '2026-11-20',
          end_date: '2026-11-25',
          cancels_regular_classes: true,
          subject_ids: [],
        });
      });

      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['semesters', '123', 'calendar'] });
      invalidateSpy.mockRestore();
    });

    test('deletes a calendar event with confirmation and handles cancellation', async () => {
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
      (api.get as any).mockImplementation((url: string) => {
        if (url === '/semesters/123') return Promise.resolve({ id: '123', name: 'Fall 2026' });
        if (url === '/semesters/123/subjects') return Promise.resolve([]);
        if (url === '/semesters/123/calendar') {
          return Promise.resolve([
            {
              id: 'ev-delete-me',
              semester_id: '123',
              title: 'Obsolete Event',
              event_type: 'holiday',
              start_date: '2026-11-01',
              end_date: '2026-11-01',
              cancels_regular_classes: true,
              subject_ids: [],
              created_at: '2026-08-01T00:00:00Z',
              updated_at: null,
            },
          ]);
        }
        return Promise.resolve(null);
      });
      (api.delete as any).mockResolvedValue(null);

      render(<SemesterDetail />, { wrapper: Wrapper });
      await waitFor(() => expect(screen.getByText('Fall 2026')).not.toBeNull());

      fireEvent.click(screen.getByRole('button', { name: /academic calendar/i }));
      await waitFor(() => expect(screen.getByText('Obsolete Event')).toBeInTheDocument());

      // 1. Cancel deletion
      const confirmSpy = vi.spyOn(window, 'confirm').mockImplementation(() => false);
      fireEvent.click(screen.getByRole('button', { name: /delete event/i }));
      expect(confirmSpy).toHaveBeenCalledWith('Are you sure you want to delete "Obsolete Event"?');
      expect(api.delete).not.toHaveBeenCalled();

      // 2. Confirm deletion
      confirmSpy.mockImplementation(() => true);
      fireEvent.click(screen.getByRole('button', { name: /delete event/i }));
      await waitFor(() => {
        expect(api.delete).toHaveBeenCalledWith('/semesters/123/calendar/ev-delete-me');
      });
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['semesters', '123', 'calendar'] });

      confirmSpy.mockRestore();
      invalidateSpy.mockRestore();
    });

    test('handles semester with optional/null boundaries gracefully', async () => {
      (api.get as any).mockImplementation((url: string) => {
        if (url === '/semesters/123') {
          return Promise.resolve({
            id: '123',
            name: 'Open Semester',
            academic_year: '2026',
            start_date: null,
            end_date: null,
          });
        }
        if (url === '/semesters/123/subjects') return Promise.resolve([]);
        if (url === '/semesters/123/calendar') return Promise.resolve([]);
        return Promise.resolve(null);
      });
      (api.post as any).mockResolvedValue({ id: 'ev-open' });

      render(<SemesterDetail />, { wrapper: Wrapper });
      await waitFor(() => expect(screen.getByText('Open Semester')).not.toBeNull());

      fireEvent.click(screen.getByRole('button', { name: /academic calendar/i }));
      await waitFor(() => expect(screen.getByRole('button', { name: /add calendar event/i })).toBeInTheDocument());

      fireEvent.click(screen.getByRole('button', { name: /add calendar event/i }));

      // Enter arbitrary future dates without boundary restrictions
      fireEvent.change(screen.getByLabelText(/event title \*/i), { target: { value: 'Anytime Holiday' } });
      fireEvent.change(screen.getByLabelText(/start date \*/i), { target: { value: '2027-05-01' } });
      fireEvent.change(screen.getByLabelText(/end date \*/i), { target: { value: '2027-05-05' } });

      fireEvent.click(screen.getByRole('button', { name: 'Add Event' }));

      await waitFor(() => {
        expect(api.post).toHaveBeenCalledWith('/semesters/123/calendar', {
          title: 'Anytime Holiday',
          event_type: 'holiday',
          start_date: '2027-05-01',
          end_date: '2027-05-05',
          cancels_regular_classes: true,
          subject_ids: [],
        });
      });
    });

    test('displays visible error feedback when API mutation fails', async () => {
      (api.get as any).mockImplementation((url: string) => {
        if (url === '/semesters/123') return Promise.resolve({ id: '123', name: 'Fall 2026' });
        if (url === '/semesters/123/subjects') return Promise.resolve([]);
        if (url === '/semesters/123/calendar') return Promise.resolve([]);
        return Promise.resolve(null);
      });
      (api.post as any).mockRejectedValue({
        data: { detail: 'Calendar event overlaps with an existing exam event' },
      });

      render(<SemesterDetail />, { wrapper: Wrapper });
      await waitFor(() => expect(screen.getByText('Fall 2026')).not.toBeNull());

      fireEvent.click(screen.getByRole('button', { name: /academic calendar/i }));
      await waitFor(() => expect(screen.getByRole('button', { name: /add calendar event/i })).toBeInTheDocument());

      fireEvent.click(screen.getByRole('button', { name: /add calendar event/i }));
      fireEvent.change(screen.getByLabelText(/event title \*/i), { target: { value: 'Overlapping Holiday' } });
      fireEvent.change(screen.getByLabelText(/start date \*/i), { target: { value: '2026-10-10' } });
      fireEvent.change(screen.getByLabelText(/end date \*/i), { target: { value: '2026-10-12' } });

      fireEvent.click(screen.getByRole('button', { name: 'Add Event' }));

      await waitFor(() => {
        expect(screen.getByText('Calendar event overlaps with an existing exam event')).toBeInTheDocument();
      });

      // Form remains open and inputs are preserved
      expect(screen.getByLabelText(/event title \*/i)).toHaveValue('Overlapping Holiday');
    });

    test('validates semester boundaries when submitting a calendar event', async () => {
      (api.get as any).mockImplementation((url: string) => {
        if (url === '/semesters/123') {
          return Promise.resolve({
            id: '123',
            name: 'Fall 2026',
            academic_year: '2026',
            start_date: '2026-08-01',
            end_date: '2026-12-15',
          });
        }
        if (url === '/semesters/123/subjects') {
          return Promise.resolve([{ id: 'sub-1', name: 'Algorithms', code: 'CS301' }]);
        }
        if (url === '/semesters/123/calendar') {
          return Promise.resolve([]);
        }
        return Promise.resolve(null);
      });

      render(<SemesterDetail />, { wrapper: Wrapper });

      await waitFor(() => {
        expect(screen.getByText('Fall 2026')).not.toBeNull();
      });

      fireEvent.click(screen.getByRole('button', { name: /academic calendar/i }));

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /add calendar event/i })).toBeInTheDocument();
      });

      fireEvent.click(screen.getByRole('button', { name: /add calendar event/i }));

      // Fill title
      fireEvent.change(screen.getByLabelText(/event title \*/i), { target: { value: 'Early Break' } });

      // 1. Boundary: event start date cannot precede semester start date (2026-08-01)
      fireEvent.change(screen.getByLabelText(/start date \*/i), { target: { value: '2026-07-20' } });
      fireEvent.change(screen.getByLabelText(/end date \*/i), { target: { value: '2026-08-10' } });
      fireEvent.click(screen.getByRole('button', { name: 'Add Event' }));

      await waitFor(() => {
        expect(screen.getByText(/event start date cannot precede semester start date \(2026-08-01\)/i)).toBeInTheDocument();
      });

      // 2. Boundary: event end date cannot exceed semester end date (2026-12-15)
      fireEvent.change(screen.getByLabelText(/start date \*/i), { target: { value: '2026-12-10' } });
      fireEvent.change(screen.getByLabelText(/end date \*/i), { target: { value: '2026-12-25' } });
      fireEvent.click(screen.getByRole('button', { name: 'Add Event' }));

      await waitFor(() => {
        expect(screen.getByText(/event end date cannot exceed semester end date \(2026-12-15\)/i)).toBeInTheDocument();
      });

      // 3. Start date cannot be after end date
      fireEvent.change(screen.getByLabelText(/start date \*/i), { target: { value: '2026-10-20' } });
      fireEvent.change(screen.getByLabelText(/end date \*/i), { target: { value: '2026-10-10' } });
      fireEvent.click(screen.getByRole('button', { name: 'Add Event' }));

      await waitFor(() => {
        expect(screen.getByText(/start date cannot be after end date/i)).toBeInTheDocument();
      });

      expect(api.post).not.toHaveBeenCalled();
    });
  });

  describe('Stage 4.2.2B Phase 2: Exam Subject and Component Selection', () => {
    const mockSubjects = [
      { id: 'sub-1', name: 'Algorithms', code: 'CS301', credits: 4 },
      { id: 'sub-2', name: 'Databases', code: 'CS302', credits: 3 },
    ];

    const mockAlgPattern = {
      id: 'pat-1',
      subject_id: 'sub-1',
      name: 'Theory Pattern',
      is_active: true,
      components: [
        { id: 'comp-1a', name: 'Midterm', category: 'exam', weightage: 30, max_marks: 100, is_active: true, order: 1 },
        { id: 'comp-1b', name: 'Final Exam', category: 'exam', weightage: 40, max_marks: 100, is_active: true, order: 2 },
      ],
    };

    const mockDbPattern = {
      id: 'pat-2',
      subject_id: 'sub-2',
      name: 'Lab Pattern',
      is_active: true,
      components: [
        { id: 'comp-2a', name: 'Midsem Test', category: 'exam', weightage: 25, max_marks: 50, is_active: true, order: 1 },
        { id: 'comp-2b', name: 'Endsem Exam', category: 'exam', weightage: 50, max_marks: 100, is_active: true, order: 2 },
      ],
    };

    const setupExamModal = async (customPatternHandler?: (url: string) => Promise<any> | undefined) => {
      (api.get as any).mockImplementation((url: string) => {
        if (url === '/semesters/123') return Promise.resolve({ id: '123', name: 'Fall 2026', start_date: '2026-08-01', end_date: '2026-12-31' });
        if (url === '/semesters/123/subjects') return Promise.resolve(mockSubjects);
        if (url === '/semesters/123/calendar') return Promise.resolve([]);
        if (customPatternHandler) {
          const res = customPatternHandler(url);
          if (res !== undefined) return res;
        }
        if (url === '/subjects/sub-1/pattern') return Promise.resolve(mockAlgPattern);
        if (url === '/subjects/sub-2/pattern') return Promise.resolve(mockDbPattern);
        return Promise.resolve(null);
      });

      render(<SemesterDetail />, { wrapper: Wrapper });
      await waitFor(() => expect(screen.getByText('Fall 2026')).not.toBeNull());

      fireEvent.click(screen.getByRole('button', { name: /academic calendar/i }));
      await waitFor(() => expect(screen.getByRole('button', { name: /add calendar event/i })).toBeInTheDocument());
      fireEvent.click(screen.getByRole('button', { name: /add calendar event/i }));
      fireEvent.change(screen.getByLabelText(/event type \*/i), { target: { value: 'exam' } });
    };

    test('1. exam form displays semester subjects', async () => {
      await setupExamModal();
      expect(screen.getByText(/Algorithms \(CS301\)/i)).toBeInTheDocument();
      expect(screen.getByText(/Databases \(CS302\)/i)).toBeInTheDocument();
    });

    test('2. pattern components load for each subject', async () => {
      await setupExamModal();
      const algCheckbox = await screen.findByLabelText(/Select Algorithms \(CS301\)/i);
      await waitFor(() => expect(algCheckbox).not.toBeDisabled());
      fireEvent.click(algCheckbox);

      const compSelect = screen.getByLabelText(/assessment component for algorithms/i);
      expect(compSelect).toBeInTheDocument();
      expect(screen.getByRole('option', { name: /Midterm \(Exam\) • 30% weight • 100 marks/i })).toBeInTheDocument();
      expect(screen.getByRole('option', { name: /Final Exam \(Exam\) • 40% weight • 100 marks/i })).toBeInTheDocument();
    });

    test('3. subjects without active patterns cannot be selected (disabled checkbox + warning message)', async () => {
      await setupExamModal((url) => {
        if (url === '/subjects/sub-1/pattern') return Promise.resolve(null);
        if (url === '/subjects/sub-2/pattern') return Promise.resolve({ ...mockDbPattern, is_active: false });
        return undefined;
      });

      const algCheckbox = await screen.findByLabelText(/Select Algorithms \(CS301\)/i);
      const dbCheckbox = await screen.findByLabelText(/Select Databases \(CS302\)/i);

      await waitFor(() => {
        expect(algCheckbox).toBeDisabled();
        expect(dbCheckbox).toBeDisabled();
      });

      const warnings = screen.getAllByText(/No active pattern configured/i);
      expect(warnings).toHaveLength(2);
      expect(screen.getAllByText(/Configure an assessment pattern in this subject's details/i)).toHaveLength(2);

      fireEvent.click(algCheckbox);
      expect(algCheckbox).not.toBeChecked();
    });

    test('4. subjects with no eligible active components (0 weightage/marks) cannot be selected', async () => {
      await setupExamModal((url) => {
        if (url === '/subjects/sub-1/pattern') {
          return Promise.resolve({
            ...mockAlgPattern,
            components: [
              { id: 'c1', name: 'Zero Weight', category: 'exam', weightage: 0, max_marks: 100, is_active: true, order: 1 },
              { id: 'c2', name: 'Zero Marks', category: 'exam', weightage: 20, max_marks: 0, is_active: true, order: 2 },
              { id: 'c3', name: 'Inactive', category: 'exam', weightage: 30, max_marks: 100, is_active: false, order: 3 },
            ],
          });
        }
        return undefined;
      });

      const algCheckbox = await screen.findByLabelText(/Select Algorithms \(CS301\)/i);
      await waitFor(() => {
        expect(algCheckbox).toBeDisabled();
      });

      expect(screen.getByText(/No eligible active components/i)).toBeInTheDocument();
      fireEvent.click(algCheckbox);
      expect(algCheckbox).not.toBeChecked();
    });

    test('5. loading state is handled with Loading pattern... and disabled input', async () => {
      let resolvePattern: any;
      const pendingPromise = new Promise((resolve) => { resolvePattern = resolve; });

      await setupExamModal((url) => {
        if (url === '/subjects/sub-1/pattern') return pendingPromise;
        return undefined;
      });

      expect(screen.getByText(/Loading pattern\.\.\./i)).toBeInTheDocument();
      const algCheckbox = screen.getByLabelText(/Select Algorithms \(CS301\)/i);
      expect(algCheckbox).toBeDisabled();

      resolvePattern(mockAlgPattern);
    });

    test('6. API errors show "Failed to load pattern" with "Retry" button', async () => {
      await setupExamModal((url) => {
        if (url === '/subjects/sub-1/pattern') return Promise.reject(new Error('Network error'));
        return undefined;
      });

      await waitFor(() => {
        expect(screen.getByText(/Failed to load pattern/i)).toBeInTheDocument();
      });

      expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument();
      const algCheckbox = screen.getByLabelText(/Select Algorithms \(CS301\)/i);
      expect(algCheckbox).toBeDisabled();
    });

    test('7. clicking Retry triggers query refetch', async () => {
      let callCount = 0;
      await setupExamModal((url) => {
        if (url === '/subjects/sub-1/pattern') {
          callCount++;
          if (callCount === 1) return Promise.reject(new Error('Initial failure'));
          return Promise.resolve(mockAlgPattern);
        }
        return undefined;
      });

      await waitFor(() => {
        expect(screen.getByText(/Failed to load pattern/i)).toBeInTheDocument();
      });

      const retryBtn = screen.getByRole('button', { name: /retry/i });
      fireEvent.click(retryBtn);

      const algCheckbox = screen.getByLabelText(/Select Algorithms \(CS301\)/i);
      await waitFor(() => {
        expect(algCheckbox).not.toBeDisabled();
      });
      expect(screen.queryByText(/Failed to load pattern/i)).not.toBeInTheDocument();
    });

    test('8. selecting a subject reveals its component selector', async () => {
      await setupExamModal();
      const algCheckbox = await screen.findByLabelText(/Select Algorithms \(CS301\)/i);
      await waitFor(() => expect(algCheckbox).not.toBeDisabled());

      expect(screen.queryByLabelText(/assessment component for algorithms/i)).not.toBeInTheDocument();

      fireEvent.click(algCheckbox);
      expect(screen.getByLabelText(/assessment component for algorithms/i)).toBeInTheDocument();

      // Deselect hides it again
      fireEvent.click(algCheckbox);
      expect(screen.queryByLabelText(/assessment component for algorithms/i)).not.toBeInTheDocument();
    });

    test('9. component selection is explicit (default is empty, no auto-select)', async () => {
      await setupExamModal();
      const algCheckbox = await screen.findByLabelText(/Select Algorithms \(CS301\)/i);
      await waitFor(() => expect(algCheckbox).not.toBeDisabled());

      fireEvent.click(algCheckbox);
      const compSelect = screen.getByLabelText(/assessment component for algorithms/i) as HTMLSelectElement;
      expect(compSelect.value).toBe('');
    });

    test('10. multiple subjects maintain independent component selections', async () => {
      await setupExamModal();
      const algCheckbox = await screen.findByLabelText(/Select Algorithms \(CS301\)/i);
      const dbCheckbox = await screen.findByLabelText(/Select Databases \(CS302\)/i);
      await waitFor(() => {
        expect(algCheckbox).not.toBeDisabled();
        expect(dbCheckbox).not.toBeDisabled();
      });

      fireEvent.click(algCheckbox);
      fireEvent.click(dbCheckbox);

      const algSelect = screen.getByLabelText(/assessment component for algorithms/i) as HTMLSelectElement;
      const dbSelect = screen.getByLabelText(/assessment component for databases/i) as HTMLSelectElement;

      fireEvent.change(algSelect, { target: { value: 'comp-1b' } });
      fireEvent.change(dbSelect, { target: { value: 'comp-2a' } });

      expect(algSelect.value).toBe('comp-1b');
      expect(dbSelect.value).toBe('comp-2a');

      // Unchecking alg and re-checking it resets alg to empty without affecting db
      fireEvent.click(algCheckbox);
      fireEvent.click(algCheckbox);

      const newAlgSelect = screen.getByLabelText(/assessment component for algorithms/i) as HTMLSelectElement;
      expect(newAlgSelect.value).toBe('');
      expect(dbSelect.value).toBe('comp-2a');
    });

    test('11. submission is blocked if a selected subject has no component selected', async () => {
      await setupExamModal();
      const algCheckbox = await screen.findByLabelText(/Select Algorithms \(CS301\)/i);
      await waitFor(() => expect(algCheckbox).not.toBeDisabled());

      fireEvent.change(screen.getByLabelText(/event title \*/i), { target: { value: 'Final Exam Week' } });
      fireEvent.change(screen.getByLabelText(/start date \*/i), { target: { value: '2026-11-01' } });
      fireEvent.change(screen.getByLabelText(/end date \*/i), { target: { value: '2026-11-05' } });

      fireEvent.click(algCheckbox);

      // Do not choose a component (remains empty)
      fireEvent.click(screen.getByRole('button', { name: 'Add Event' }));

      await waitFor(() => {
        expect(screen.getByText(/please select an assessment component for this subject/i)).toBeInTheDocument();
      });

      expect(api.post).not.toHaveBeenCalled();
    });

    test('12. correct subject_ids and subject_components are sent on valid submission', async () => {
      (api.post as any).mockResolvedValue({ id: 'ev-exam-full' });
      await setupExamModal();

      const algCheckbox = await screen.findByLabelText(/Select Algorithms \(CS301\)/i);
      const dbCheckbox = await screen.findByLabelText(/Select Databases \(CS302\)/i);
      await waitFor(() => {
        expect(algCheckbox).not.toBeDisabled();
        expect(dbCheckbox).not.toBeDisabled();
      });

      fireEvent.change(screen.getByLabelText(/event title \*/i), { target: { value: 'Midterm Assessments' } });
      fireEvent.change(screen.getByLabelText(/start date \*/i), { target: { value: '2026-10-10' } });
      fireEvent.change(screen.getByLabelText(/end date \*/i), { target: { value: '2026-10-14' } });

      fireEvent.click(algCheckbox);
      fireEvent.click(dbCheckbox);

      const algSelect = screen.getByLabelText(/assessment component for algorithms/i);
      const dbSelect = screen.getByLabelText(/assessment component for databases/i);

      fireEvent.change(algSelect, { target: { value: 'comp-1a' } });
      fireEvent.change(dbSelect, { target: { value: 'comp-2b' } });

      fireEvent.click(screen.getByRole('button', { name: 'Add Event' }));

      await waitFor(() => {
        expect(api.post).toHaveBeenCalledWith('/semesters/123/calendar', {
          title: 'Midterm Assessments',
          event_type: 'exam',
          start_date: '2026-10-10',
          end_date: '2026-10-14',
          cancels_regular_classes: false,
          subject_ids: ['sub-1', 'sub-2'],
          subject_components: [
            { subject_id: 'sub-1', pattern_component_id: 'comp-1a' },
            { subject_id: 'sub-2', pattern_component_id: 'comp-2b' },
          ],
        });
      });
    });

    test('13. non-exam event creation remains unchanged (holiday sends subject_ids: [] and no subject_components)', async () => {
      (api.post as any).mockResolvedValue({ id: 'ev-holiday' });
      await setupExamModal();

      // Switch event type to holiday
      fireEvent.change(screen.getByLabelText(/event type \*/i), { target: { value: 'holiday' } });

      // Subject selector should not be rendered
      expect(screen.queryByText(/Associated Exam Subjects & Components/i)).not.toBeInTheDocument();

      fireEvent.change(screen.getByLabelText(/event title \*/i), { target: { value: 'National Holiday' } });
      fireEvent.change(screen.getByLabelText(/start date \*/i), { target: { value: '2026-10-02' } });
      fireEvent.change(screen.getByLabelText(/end date \*/i), { target: { value: '2026-10-02' } });

      fireEvent.click(screen.getByRole('button', { name: 'Add Event' }));

      await waitFor(() => {
        expect(api.post).toHaveBeenCalledWith('/semesters/123/calendar', {
          title: 'National Holiday',
          event_type: 'holiday',
          start_date: '2026-10-02',
          end_date: '2026-10-02',
          cancels_regular_classes: true,
          subject_ids: [],
        });
      });
    });
  });

  describe('Stage 4.2.2B Phase 3: Safe Editing of Existing Exam Events', () => {
    const mockSubjects = [
      { id: 'sub-1', name: 'Algorithms', code: 'CS301', credits: 4 },
      { id: 'sub-2', name: 'Databases', code: 'CS302', credits: 3 },
      { id: 'sub-3', name: 'Networks', code: 'CS303', credits: 3 },
    ];

    const mockAlgPattern = {
      id: 'pat-1',
      subject_id: 'sub-1',
      name: 'Theory Pattern',
      is_active: true,
      components: [
        { id: 'comp-1a', name: 'Midterm', category: 'exam', weightage: 30, max_marks: 100, is_active: true, order: 1 },
        { id: 'comp-1b', name: 'Final Exam', category: 'exam', weightage: 40, max_marks: 100, is_active: true, order: 2 },
      ],
    };

    const mockDbPattern = {
      id: 'pat-2',
      subject_id: 'sub-2',
      name: 'Lab Pattern',
      is_active: true,
      components: [
        { id: 'comp-2a', name: 'Midsem Test', category: 'exam', weightage: 25, max_marks: 50, is_active: true, order: 1 },
        { id: 'comp-2b', name: 'Endsem Exam', category: 'exam', weightage: 50, max_marks: 100, is_active: true, order: 2 },
      ],
    };

    const mockNetPattern = {
      id: 'pat-3',
      subject_id: 'sub-3',
      name: 'Network Pattern',
      is_active: true,
      components: [
        { id: 'comp-3a', name: 'Quiz', category: 'quiz', weightage: 15, max_marks: 30, is_active: true, order: 1 },
      ],
    };

    const existingExamEvent = {
      id: 'ev-exam-100',
      semester_id: '123',
      title: 'Midterm Assessment Week',
      event_type: 'exam',
      start_date: '2026-10-10',
      end_date: '2026-10-15',
      cancels_regular_classes: false,
      subject_ids: ['sub-1', 'sub-2'],
      assessment_ids: ['ass-1', 'ass-2'],
      created_at: '2026-08-01T00:00:00Z',
      updated_at: null,
    };

    const mockSub1Assessments = [
      {
        id: 'ass-1',
        name: 'Algorithms - Midterm',
        category: 'midsem',
        max_marks: 100,
        marks: null,
        weightage: 30,
        scheduled_at: '2026-10-10T12:00:00Z',
        status: 'pending',
        subject_id: 'sub-1',
        calendar_event_id: 'ev-exam-100',
        pattern_component_id: 'comp-1a',
        is_auto_generated: true,
        created_at: '2026-08-01T00:00:00Z',
        updated_at: null,
      },
      {
        id: 'ass-unrelated',
        name: 'Algorithms - Quiz 1',
        category: 'quiz',
        max_marks: 20,
        marks: 18,
        weightage: 10,
        scheduled_at: '2026-09-10T12:00:00Z',
        status: 'scored',
        subject_id: 'sub-1',
        calendar_event_id: 'ev-other',
        pattern_component_id: 'comp-1b',
        is_auto_generated: false,
        created_at: '2026-08-01T00:00:00Z',
        updated_at: null,
      },
    ];

    const mockSub2Assessments = [
      {
        id: 'ass-2',
        name: 'Databases - Midsem Test',
        category: 'midsem',
        max_marks: 50,
        marks: null,
        weightage: 25,
        scheduled_at: '2026-10-10T12:00:00Z',
        status: 'exempt',
        subject_id: 'sub-2',
        calendar_event_id: 'ev-exam-100',
        pattern_component_id: 'comp-2a',
        is_auto_generated: true,
        created_at: '2026-08-01T00:00:00Z',
        updated_at: null,
      },
    ];

    const setupEditExamModal = async (overrides?: {
      event?: any;
      sub1Assessments?: any;
      sub2Assessments?: any;
      sub3Assessments?: any;
      customHandler?: (url: string) => Promise<any> | undefined;
    }) => {
      const event = overrides?.event || existingExamEvent;
      (api.get as any).mockImplementation((url: string) => {
        if (url === '/semesters/123') return Promise.resolve({ id: '123', name: 'Fall 2026', start_date: '2026-08-01', end_date: '2026-12-31' });
        if (url === '/semesters/123/subjects') return Promise.resolve(mockSubjects);
        if (url === '/semesters/123/calendar') return Promise.resolve([event]);
        if (overrides?.customHandler) {
          const res = overrides.customHandler(url);
          if (res !== undefined) return res;
        }
        if (url === '/subjects/sub-1/pattern') return Promise.resolve(mockAlgPattern);
        if (url === '/subjects/sub-2/pattern') return Promise.resolve(mockDbPattern);
        if (url === '/subjects/sub-3/pattern') return Promise.resolve(mockNetPattern);
        if (url === '/subjects/sub-1/assessments') return Promise.resolve(overrides?.sub1Assessments ?? mockSub1Assessments);
        if (url === '/subjects/sub-2/assessments') return Promise.resolve(overrides?.sub2Assessments ?? mockSub2Assessments);
        if (url === '/subjects/sub-3/assessments') return Promise.resolve(overrides?.sub3Assessments ?? []);
        return Promise.resolve(null);
      });

      render(<SemesterDetail />, { wrapper: Wrapper });
      await waitFor(() => expect(screen.getByText('Fall 2026')).not.toBeNull());

      fireEvent.click(screen.getByRole('button', { name: /academic calendar/i }));
      await waitFor(() => expect(screen.getByText(event.title)).toBeInTheDocument());

      fireEvent.click(screen.getByRole('button', { name: /edit event/i }));
      await waitFor(() => expect(screen.getByRole('heading', { name: 'Edit Calendar Event' })).toBeInTheDocument());
    };

    test('1. existing exam event opens with its original subjects selected', async () => {
      await setupEditExamModal();
      const algCheckbox = screen.getByLabelText(/Select Algorithms \(CS301\)/i) as HTMLInputElement;
      const dbCheckbox = screen.getByLabelText(/Select Databases \(CS302\)/i) as HTMLInputElement;
      const netCheckbox = screen.getByLabelText(/Select Networks \(CS303\)/i) as HTMLInputElement;

      expect(algCheckbox.checked).toBe(true);
      expect(dbCheckbox.checked).toBe(true);
      expect(netCheckbox.checked).toBe(false);
    });

    test('2. linked Assessments correctly prepopulate component selections', async () => {
      await setupEditExamModal();
      await waitFor(() => {
        const algSelect = screen.getByLabelText(/assessment component for algorithms/i) as HTMLSelectElement;
        const dbSelect = screen.getByLabelText(/assessment component for databases/i) as HTMLSelectElement;
        expect(algSelect.value).toBe('comp-1a');
        expect(dbSelect.value).toBe('comp-2a');
      });
    });

    test('3. assessment mapping is matched by event ID and subject ID', async () => {
      await setupEditExamModal();
      await waitFor(() => {
        const algSelect = screen.getByLabelText(/assessment component for algorithms/i) as HTMLSelectElement;
        // Selected comp-1a (from ass-1 with matching calendar_event_id), NOT comp-1b (from ass-unrelated)
        expect(algSelect.value).toBe('comp-1a');
      });
    });

    test('4. an unrelated Assessment for the same subject is ignored', async () => {
      await setupEditExamModal();
      await waitFor(() => {
        const algSelect = screen.getByLabelText(/assessment component for algorithms/i) as HTMLSelectElement;
        expect(algSelect.value).not.toBe('comp-1b');
      });
    });

    test('5. missing linked Assessment/component ID does not trigger a guessed default', async () => {
      const assessmentWithoutComponent = [
        {
          id: 'ass-legacy',
          name: 'Algorithms - Midterm',
          category: 'midsem',
          max_marks: 100,
          marks: null,
          weightage: 30,
          scheduled_at: '2026-10-10T12:00:00Z',
          status: 'pending',
          subject_id: 'sub-1',
          calendar_event_id: 'ev-exam-100',
          pattern_component_id: null,
          created_at: '2026-08-01T00:00:00Z',
          updated_at: null,
        },
      ];

      await setupEditExamModal({ sub1Assessments: assessmentWithoutComponent });
      await waitFor(() => {
        const algSelect = screen.getByLabelText(/assessment component for algorithms/i) as HTMLSelectElement;
        expect(algSelect.value).toBe('');
        expect(screen.getByText(/Linked assessment has no pattern component configured/i)).toBeInTheDocument();
      });
    });

    test('6. loading prevents unsafe submission', async () => {
      let resolveAssessments: any;
      const pendingPromise = new Promise((resolve) => { resolveAssessments = resolve; });

      await setupEditExamModal({
        customHandler: (url) => {
          if (url === '/subjects/sub-1/assessments') return pendingPromise;
          return undefined;
        },
      });

      expect(screen.getByText(/Loading existing assessment links for this exam event/i)).toBeInTheDocument();
      const submitBtn = screen.getByRole('button', { name: 'Update Event' });
      expect(submitBtn).toBeDisabled();

      resolveAssessments(mockSub1Assessments);
    });

    test('7. mapping fetch failure prevents unsafe submission', async () => {
      await setupEditExamModal({
        customHandler: (url) => {
          if (url === '/subjects/sub-1/assessments') return Promise.reject(new Error('Failed to fetch'));
          return undefined;
        },
      });

      await waitFor(() => {
        expect(screen.getByText(/Failed to load assessment mappings/i)).toBeInTheDocument();
      });

      const submitBtn = screen.getByRole('button', { name: 'Update Event' });
      expect(submitBtn).toBeDisabled();
      expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument();
    });

    test('8. retry successfully loads the mappings', async () => {
      let callCount = 0;
      await setupEditExamModal({
        customHandler: (url) => {
          if (url === '/subjects/sub-1/assessments') {
            callCount++;
            if (callCount === 1) return Promise.reject(new Error('Temporary network drop'));
            return Promise.resolve(mockSub1Assessments);
          }
          return undefined;
        },
      });

      await waitFor(() => {
        expect(screen.getByText(/Failed to load assessment mappings/i)).toBeInTheDocument();
      });

      fireEvent.click(screen.getByRole('button', { name: /retry/i }));

      await waitFor(() => {
        const algSelect = screen.getByLabelText(/assessment component for algorithms/i) as HTMLSelectElement;
        expect(algSelect.value).toBe('comp-1a');
      });
      expect(screen.queryByText(/Failed to load assessment mappings/i)).not.toBeInTheDocument();
    });

    test('9. title-only edit omits subject_ids and subject_components', async () => {
      (api.put as any).mockResolvedValue({ ...existingExamEvent, title: 'Renamed Exam Week' });
      await setupEditExamModal();

      await waitFor(() => {
        const algSelect = screen.getByLabelText(/assessment component for algorithms/i) as HTMLSelectElement;
        expect(algSelect.value).toBe('comp-1a');
      });

      fireEvent.change(screen.getByLabelText(/event title \*/i), { target: { value: 'Renamed Exam Week' } });
      fireEvent.click(screen.getByRole('button', { name: 'Update Event' }));

      await waitFor(() => {
        expect(api.put).toHaveBeenCalledWith('/semesters/123/calendar/ev-exam-100', {
          title: 'Renamed Exam Week',
          event_type: 'exam',
          start_date: '2026-10-10',
          end_date: '2026-10-15',
          cancels_regular_classes: false,
        });
      });
    });

    test('10. date-only edit omits both fields', async () => {
      (api.put as any).mockResolvedValue({ ...existingExamEvent, start_date: '2026-10-12', end_date: '2026-10-16' });
      await setupEditExamModal();

      await waitFor(() => {
        const algSelect = screen.getByLabelText(/assessment component for algorithms/i) as HTMLSelectElement;
        expect(algSelect.value).toBe('comp-1a');
      });

      fireEvent.change(screen.getByLabelText(/start date \*/i), { target: { value: '2026-10-12' } });
      fireEvent.change(screen.getByLabelText(/end date \*/i), { target: { value: '2026-10-16' } });
      fireEvent.click(screen.getByRole('button', { name: 'Update Event' }));

      await waitFor(() => {
        expect(api.put).toHaveBeenCalledWith('/semesters/123/calendar/ev-exam-100', {
          title: 'Midterm Assessment Week',
          event_type: 'exam',
          start_date: '2026-10-12',
          end_date: '2026-10-16',
          cancels_regular_classes: false,
        });
      });
    });

    test('11. adding a subject requires explicit component selection', async () => {
      await setupEditExamModal();
      await waitFor(() => {
        const algSelect = screen.getByLabelText(/assessment component for algorithms/i) as HTMLSelectElement;
        expect(algSelect.value).toBe('comp-1a');
      });

      const netCheckbox = screen.getByLabelText(/Select Networks \(CS303\)/i);
      fireEvent.click(netCheckbox);

      const netSelect = screen.getByLabelText(/assessment component for networks/i) as HTMLSelectElement;
      expect(netSelect.value).toBe('');

      // Try to submit without picking component for Networks
      fireEvent.click(screen.getByRole('button', { name: 'Update Event' }));

      await waitFor(() => {
        expect(screen.getByText(/please select an assessment component for this subject/i)).toBeInTheDocument();
      });
      expect(api.put).not.toHaveBeenCalled();
    });

    test('12. unchanged subjects preserve their component mapping when new subject is added', async () => {
      (api.put as any).mockResolvedValue({ ...existingExamEvent, subject_ids: ['sub-1', 'sub-2', 'sub-3'] });
      await setupEditExamModal();
      await waitFor(() => {
        const algSelect = screen.getByLabelText(/assessment component for algorithms/i) as HTMLSelectElement;
        expect(algSelect.value).toBe('comp-1a');
      });

      const netCheckbox = screen.getByLabelText(/Select Networks \(CS303\)/i);
      fireEvent.click(netCheckbox);

      const netSelect = screen.getByLabelText(/assessment component for networks/i);
      fireEvent.change(netSelect, { target: { value: 'comp-3a' } });

      fireEvent.click(screen.getByRole('button', { name: 'Update Event' }));

      await waitFor(() => {
        expect(api.put).toHaveBeenCalledWith('/semesters/123/calendar/ev-exam-100', {
          title: 'Midterm Assessment Week',
          event_type: 'exam',
          start_date: '2026-10-10',
          end_date: '2026-10-15',
          cancels_regular_classes: false,
          subject_ids: ['sub-1', 'sub-2', 'sub-3'],
          subject_components: [
            { subject_id: 'sub-1', pattern_component_id: 'comp-1a' },
            { subject_id: 'sub-2', pattern_component_id: 'comp-2a' },
            { subject_id: 'sub-3', pattern_component_id: 'comp-3a' },
          ],
        });
      });
    });

    test('13. removing a subject excludes it from both payload fields', async () => {
      (api.put as any).mockResolvedValue({ ...existingExamEvent, subject_ids: ['sub-2'] });
      await setupEditExamModal();
      await waitFor(() => {
        const algSelect = screen.getByLabelText(/assessment component for algorithms/i) as HTMLSelectElement;
        expect(algSelect.value).toBe('comp-1a');
      });

      const algCheckbox = screen.getByLabelText(/Select Algorithms \(CS301\)/i);
      fireEvent.click(algCheckbox);

      // Warning about detachment is shown
      expect(screen.getByText(/Subject will be removed from this exam. Its linked assessment will be detached/i)).toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: 'Update Event' }));

      await waitFor(() => {
        expect(api.put).toHaveBeenCalledWith('/semesters/123/calendar/ev-exam-100', {
          title: 'Midterm Assessment Week',
          event_type: 'exam',
          start_date: '2026-10-10',
          end_date: '2026-10-15',
          cancels_regular_classes: false,
          subject_ids: ['sub-2'],
          subject_components: [
            { subject_id: 'sub-2', pattern_component_id: 'comp-2a' },
          ],
        });
      });
    });

    test('14. removing a subject does not trigger any Assessment deletion or exemption request', async () => {
      (api.put as any).mockResolvedValue({ ...existingExamEvent, subject_ids: ['sub-2'] });
      await setupEditExamModal();
      await waitFor(() => {
        const algSelect = screen.getByLabelText(/assessment component for algorithms/i) as HTMLSelectElement;
        expect(algSelect.value).toBe('comp-1a');
      });

      const algCheckbox = screen.getByLabelText(/Select Algorithms \(CS301\)/i);
      fireEvent.click(algCheckbox);

      fireEvent.click(screen.getByRole('button', { name: 'Update Event' }));

      await waitFor(() => {
        expect(api.put).toHaveBeenCalledWith('/semesters/123/calendar/ev-exam-100', expect.any(Object));
      });

      // No delete or assessment status update occurred
      expect(api.delete).not.toHaveBeenCalled();
      expect(api.put).not.toHaveBeenCalledWith(expect.stringMatching(/\/assessments\//), expect.any(Object));
    });

    test('15. changing a component on a non-exempt Assessment is blocked or handled through the expected 409 response', async () => {
      await setupEditExamModal();
      await waitFor(() => {
        const algSelect = screen.getByLabelText(/assessment component for algorithms/i) as HTMLSelectElement;
        expect(algSelect.value).toBe('comp-1a');
        expect(algSelect).toBeDisabled();
        expect(screen.getByText(/Component cannot be changed: active assessment \(pending\) exists/i)).toBeInTheDocument();
      });
    });

    test('16. exempt Assessment replacement sends the correct mapping', async () => {
      (api.put as any).mockResolvedValue({ ...existingExamEvent });
      await setupEditExamModal();
      await waitFor(() => {
        const dbSelect = screen.getByLabelText(/assessment component for databases/i) as HTMLSelectElement;
        expect(dbSelect.value).toBe('comp-2a');
        expect(dbSelect).not.toBeDisabled();
        expect(screen.getByText(/Exempt assessment: component replacement is permitted/i)).toBeInTheDocument();
      });

      const dbSelect = screen.getByLabelText(/assessment component for databases/i);
      fireEvent.change(dbSelect, { target: { value: 'comp-2b' } });

      fireEvent.click(screen.getByRole('button', { name: 'Update Event' }));

      await waitFor(() => {
        expect(api.put).toHaveBeenCalledWith('/semesters/123/calendar/ev-exam-100', {
          title: 'Midterm Assessment Week',
          event_type: 'exam',
          start_date: '2026-10-10',
          end_date: '2026-10-15',
          cancels_regular_classes: false,
          subject_ids: ['sub-1', 'sub-2'],
          subject_components: [
            { subject_id: 'sub-1', pattern_component_id: 'comp-1a' },
            { subject_id: 'sub-2', pattern_component_id: 'comp-2b' },
          ],
        });
      });
    });

    test('17. clearing all subjects intentionally sends empty arrays', async () => {
      (api.put as any).mockResolvedValue({ ...existingExamEvent, subject_ids: [] });
      await setupEditExamModal();
      await waitFor(() => {
        const algSelect = screen.getByLabelText(/assessment component for algorithms/i) as HTMLSelectElement;
        expect(algSelect.value).toBe('comp-1a');
      });

      const algCheckbox = screen.getByLabelText(/Select Algorithms \(CS301\)/i);
      const dbCheckbox = screen.getByLabelText(/Select Databases \(CS302\)/i);
      fireEvent.click(algCheckbox);
      fireEvent.click(dbCheckbox);

      fireEvent.click(screen.getByRole('button', { name: 'Update Event' }));

      await waitFor(() => {
        expect(api.put).toHaveBeenCalledWith('/semesters/123/calendar/ev-exam-100', {
          title: 'Midterm Assessment Week',
          event_type: 'exam',
          start_date: '2026-10-10',
          end_date: '2026-10-15',
          cancels_regular_classes: false,
          subject_ids: [],
          subject_components: [],
        });
      });
    });

    test('18. non-exam edit behavior remains unchanged', async () => {
      const holidayEvent = {
        id: 'ev-holiday-1',
        semester_id: '123',
        title: 'Mid-term Break',
        event_type: 'holiday',
        start_date: '2026-09-20',
        end_date: '2026-09-25',
        cancels_regular_classes: true,
        subject_ids: [],
        created_at: '2026-08-01T00:00:00Z',
        updated_at: null,
      };

      (api.put as any).mockResolvedValue({ ...holidayEvent, title: 'Extended Mid-term Break' });
      await setupEditExamModal({ event: holidayEvent });

      fireEvent.change(screen.getByLabelText(/event title \*/i), { target: { value: 'Extended Mid-term Break' } });
      fireEvent.click(screen.getByRole('button', { name: 'Update Event' }));

      await waitFor(() => {
        expect(api.put).toHaveBeenCalledWith('/semesters/123/calendar/ev-holiday-1', {
          title: 'Extended Mid-term Break',
          event_type: 'holiday',
          start_date: '2026-09-20',
          end_date: '2026-09-25',
          cancels_regular_classes: true,
          subject_ids: [],
        });
      });
    });

    test('19. backend 409 and 422 messages are understandable', async () => {
      (api.put as any).mockRejectedValue({
        data: {
          detail: "Cannot replace component for 'Algorithms' because an active assessment already exists. Exempt or delete it first.",
        },
      });

      await setupEditExamModal();
      await waitFor(() => {
        const dbSelect = screen.getByLabelText(/assessment component for databases/i) as HTMLSelectElement;
        expect(dbSelect.value).toBe('comp-2a');
      });

      // Change exempt db component to trigger update mutation
      const dbSelect = screen.getByLabelText(/assessment component for databases/i);
      fireEvent.change(dbSelect, { target: { value: 'comp-2b' } });

      fireEvent.click(screen.getByRole('button', { name: 'Update Event' }));

      await waitFor(() => {
        expect(screen.getByText(/Cannot replace component for 'Algorithms' because an active assessment already exists/i)).toBeInTheDocument();
      });
    });
  });
});
