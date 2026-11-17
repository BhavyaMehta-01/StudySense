import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { describe, test, expect, vi, beforeEach } from 'vitest';
import { BrowserRouter, Routes, Route } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import SubjectDetail from './SubjectDetail';
import { api } from '@/api/client';

vi.mock('@/api/client', () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
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
        <Route path="/app/semesters/:semesterId/subjects/:subjectId" element={children} />
      </Routes>
    </BrowserRouter>
  </QueryClientProvider>
);

describe('SubjectDetail - Attendance', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queryClient.clear();
    window.history.pushState({}, 'Test', '/app/semesters/1/subjects/2');

    (api.get as any).mockImplementation((url: string) => {
      if (url === '/semesters/1') return Promise.resolve({ id: '1', name: 'Fall 2026' });
      if (url === '/subjects/2') return Promise.resolve({ id: '2', name: 'Math 101', code: 'M101' });
      if (url === '/subjects/2/assessments') return Promise.resolve([]);
      if (url === '/subjects/2/attendance') return Promise.resolve([]);
      return Promise.resolve(null);
    });
  });

  test('renders empty attendance state', async () => {
    render(<SubjectDetail />, { wrapper: Wrapper });
    await waitFor(() => {
      expect(screen.getByText('No attendance recorded')).not.toBeNull();
    });
  });

  test('renders attendance list and percentage correctly', async () => {
    (api.get as any).mockImplementation((url: string) => {
      if (url === '/semesters/1') return Promise.resolve({ id: '1', name: 'Fall 2026' });
      if (url === '/subjects/2') return Promise.resolve({ id: '2', name: 'Math 101' });
      if (url === '/subjects/2/assessments') return Promise.resolve([]);
      if (url === '/subjects/2/attendance') return Promise.resolve([
        { id: 'att1', classes_attended: 10, classes_held: 10, recorded_on: '2026-09-01' },
        { id: 'att2', classes_attended: 0, classes_held: 5, recorded_on: '2026-09-02' },
        { id: 'att3', classes_attended: 0, classes_held: 0, recorded_on: '2026-09-03' }, // Handle 0 held safely
      ]);
      return Promise.resolve(null);
    });

    render(<SubjectDetail />, { wrapper: Wrapper });

    await waitFor(() => {
      const pcts = screen.getAllByTestId('attendance-pct');
      const fractions = screen.getAllByTestId('attendance-fraction');

      // 10/10 -> 100%
      expect(pcts[0].textContent).toContain('100.0%');
      expect(fractions[0].textContent).toContain('10 / 10');

      // 0/5 -> 0%
      expect(pcts[1].textContent).toContain('0.0%');
      expect(fractions[1].textContent).toContain('0 / 5');

      // 0/0 -> N/A
      expect(pcts[2].textContent).toContain('N/A');
      expect(fractions[2].textContent).toContain('0 / 0');
    });
  });

  test('validates attendance creation form', async () => {
    render(<SubjectDetail />, { wrapper: Wrapper });

    await waitFor(() => expect(screen.getByText('No attendance recorded')).not.toBeNull());

    fireEvent.click(screen.getAllByRole('button', { name: /record attendance/i })[0]);

    // Clear the default date field
    fireEvent.change(screen.getByLabelText(/date \*/i), { target: { value: '' } });
    fireEvent.click(screen.getAllByRole('button', { name: /record attendance/i })[1]);

    await waitFor(() => {
      expect(screen.getByText(/classes attended is required/i)).not.toBeNull();
      expect(screen.getByText(/classes held is required/i)).not.toBeNull();
      expect(screen.getByText(/date is required/i)).not.toBeNull();
    });

    // Test custom validation (negative, > held)
    fireEvent.change(screen.getByLabelText(/attended \*/i), { target: { value: '-1' } });
    fireEvent.change(screen.getByLabelText(/held \*/i), { target: { value: '5' } });
    fireEvent.click(screen.getAllByRole('button', { name: /record attendance/i })[1]);

    await waitFor(() => {
      expect(screen.getByText(/must be integer (>=|≥) 0/i)).not.toBeNull();
    });

    // Test fractional attended
    fireEvent.change(screen.getByLabelText(/attended \*/i), { target: { value: '2.5' } });
    fireEvent.change(screen.getByLabelText(/held \*/i), { target: { value: '5' } });
    fireEvent.click(screen.getAllByRole('button', { name: /record attendance/i })[1]);

    await waitFor(() => {
      expect(screen.getByText(/classes attended must be a whole number/i)).not.toBeNull();
      expect(screen.queryByText(/must be integer/i)).toBeNull();
    });

    fireEvent.change(screen.getByLabelText(/attended \*/i), { target: { value: '6' } });
    fireEvent.change(screen.getByLabelText(/held \*/i), { target: { value: '5' } });
    fireEvent.click(screen.getAllByRole('button', { name: /record attendance/i })[1]);

    await waitFor(() => {
      expect(screen.getByText(/attended cannot exceed held/i)).not.toBeNull();
    });

    // Test held = 0
    fireEvent.change(screen.getByLabelText(/attended \*/i), { target: { value: '0' } });
    fireEvent.change(screen.getByLabelText(/held \*/i), { target: { value: '0' } });
    fireEvent.click(screen.getAllByRole('button', { name: /record attendance/i })[1]);

    await waitFor(() => {
      expect(screen.getByText(/classes held must be greater than zero/i)).not.toBeNull();
    });

    // Test fractional held (e.g. 6.5)
    fireEvent.change(screen.getByLabelText(/attended \*/i), { target: { value: '4' } });
    fireEvent.change(screen.getByLabelText(/held \*/i), { target: { value: '6.5' } });
    fireEvent.click(screen.getAllByRole('button', { name: /record attendance/i })[1]);

    await waitFor(() => {
      expect(screen.getByText(/classes held must be a whole number/i)).not.toBeNull();
      expect(screen.queryByText(/classes held must be greater than zero/i)).toBeNull();
    });

    // Test invalid date format in creation form
    fireEvent.change(screen.getByLabelText(/date \*/i), { target: { value: '31-02-2026' } });
    fireEvent.click(screen.getAllByRole('button', { name: /record attendance/i })[1]);

    await waitFor(() => {
      expect(screen.getByText(/please enter a valid date/i)).not.toBeNull();
      expect(screen.queryByText(/^date is required$/i)).toBeNull();
    });
  });

  test('creates attendance successfully', async () => {
    (api.post as any).mockResolvedValueOnce({ id: 'att-new' });

    render(<SubjectDetail />, { wrapper: Wrapper });

    await waitFor(() => expect(screen.getByText('No attendance recorded')).not.toBeNull());

    fireEvent.click(screen.getAllByRole('button', { name: /record attendance/i })[0]);

    fireEvent.change(screen.getByLabelText(/attended \*/i), { target: { value: '8' } });
    fireEvent.change(screen.getByLabelText(/held \*/i), { target: { value: '10' } });
    fireEvent.change(screen.getByLabelText(/date \*/i), { target: { value: '2026-09-10' } });

    fireEvent.click(screen.getAllByRole('button', { name: /record attendance/i })[1]);

    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith('/subjects/2/attendance', {
        classes_attended: 8,
        classes_held: 10,
        recorded_on: '2026-09-10'
      });
    });
  });

  test('updates attendance successfully', async () => {
    (api.get as any).mockImplementation((url: string) => {
      if (url === '/semesters/1') return Promise.resolve({ id: '1', name: 'Fall 2026' });
      if (url === '/subjects/2') return Promise.resolve({ id: '2', name: 'Math 101' });
      if (url === '/subjects/2/assessments') return Promise.resolve([]);
      if (url === '/subjects/2/attendance') return Promise.resolve([
        { id: 'att-edit', classes_attended: 6, classes_held: 8, recorded_on: '2026-09-01' }
      ]);
      return Promise.resolve(null);
    });

    (api.put as any).mockResolvedValueOnce({ id: 'att-edit' });

    render(<SubjectDetail />, { wrapper: Wrapper });

    await waitFor(() => expect(screen.getAllByTestId('attendance-pct').length).toBe(1));

    const editButton = screen.getByRole('button', { name: 'Edit attendance' });
    fireEvent.click(editButton);

    await waitFor(() => {
      expect((screen.getByLabelText(/attended \*/i) as HTMLInputElement).value).toBe('6');
      expect((screen.getByLabelText(/held \*/i) as HTMLInputElement).value).toBe('8');
    });

    fireEvent.change(screen.getByLabelText(/attended \*/i), { target: { value: '4' } });


    fireEvent.click(screen.getByRole('button', { name: /save changes/i }));

    await waitFor(() => {
      expect(api.put).toHaveBeenCalledWith('/attendance/att-edit', {
        classes_attended: 4,
        classes_held: 8,
        recorded_on: '2026-09-01',
      });
    });
  });

  test('validates attendance edit form and prevents submission when classes held is 0', async () => {
    (api.get as any).mockImplementation((url: string) => {
      if (url === '/semesters/1') return Promise.resolve({ id: '1', name: 'Fall 2026' });
      if (url === '/subjects/2') return Promise.resolve({ id: '2', name: 'Math 101' });
      if (url === '/subjects/2/assessments') return Promise.resolve([]);
      if (url === '/subjects/2/attendance') return Promise.resolve([
        { id: 'att-edit', classes_attended: 6, classes_held: 8, recorded_on: '2026-09-01' }
      ]);
      return Promise.resolve(null);
    });

    render(<SubjectDetail />, { wrapper: Wrapper });
    await waitFor(() => expect(screen.getAllByTestId('attendance-pct').length).toBe(1));

    const editButton = screen.getByRole('button', { name: 'Edit attendance' });
    fireEvent.click(editButton);

    await waitFor(() => {
      expect((screen.getByLabelText(/attended \*/i) as HTMLInputElement).value).toBe('6');
      expect((screen.getByLabelText(/held \*/i) as HTMLInputElement).value).toBe('8');
    });

    fireEvent.change(screen.getByLabelText(/attended \*/i), { target: { value: '0' } });
    fireEvent.change(screen.getByLabelText(/held \*/i), { target: { value: '0' } });
    fireEvent.click(screen.getByRole('button', { name: /save changes/i }));

    await waitFor(() => {
      expect(screen.getByText(/classes held must be greater than zero/i)).not.toBeNull();
    });

    expect(api.put).not.toHaveBeenCalled();

    // Cancel edit to ensure the existing record is preserved
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
    await waitFor(() => {
      expect(screen.getByText('6 / 8')).not.toBeNull();
    });
  });

  test('validates attendance edit form with fractional and negative values', async () => {
    (api.get as any).mockImplementation((url: string) => {
      if (url === '/semesters/1') return Promise.resolve({ id: '1', name: 'Fall 2026' });
      if (url === '/subjects/2') return Promise.resolve({ id: '2', name: 'Math 101' });
      if (url === '/subjects/2/assessments') return Promise.resolve([]);
      if (url === '/subjects/2/attendance') return Promise.resolve([
        { id: 'att-edit', classes_attended: 6, classes_held: 8, recorded_on: '2026-09-01' }
      ]);
      return Promise.resolve(null);
    });

    render(<SubjectDetail />, { wrapper: Wrapper });
    await waitFor(() => expect(screen.getAllByTestId('attendance-pct').length).toBe(1));

    const editButton = screen.getByRole('button', { name: 'Edit attendance' });
    fireEvent.click(editButton);

    await waitFor(() => {
      expect((screen.getByLabelText(/attended \*/i) as HTMLInputElement).value).toBe('6');
      expect((screen.getByLabelText(/held \*/i) as HTMLInputElement).value).toBe('8');
    });

    // 1. Fractional classes held (6.5)
    fireEvent.change(screen.getByLabelText(/held \*/i), { target: { value: '6.5' } });
    fireEvent.click(screen.getByRole('button', { name: /save changes/i }));

    await waitFor(() => {
      expect(screen.getByText(/classes held must be a whole number/i)).not.toBeNull();
      expect(screen.queryByText(/classes held must be greater than zero/i)).toBeNull();
    });
    expect(api.put).not.toHaveBeenCalled();

    // 2. Fractional classes attended (2.5)
    fireEvent.change(screen.getByLabelText(/held \*/i), { target: { value: '8' } });
    fireEvent.change(screen.getByLabelText(/attended \*/i), { target: { value: '2.5' } });
    fireEvent.click(screen.getByRole('button', { name: /save changes/i }));

    await waitFor(() => {
      expect(screen.getByText(/classes attended must be a whole number/i)).not.toBeNull();
      expect(screen.queryByText(/must be integer/i)).toBeNull();
    });
    expect(api.put).not.toHaveBeenCalled();

    // 3. Negative classes attended (-1)
    fireEvent.change(screen.getByLabelText(/attended \*/i), { target: { value: '-1' } });
    fireEvent.click(screen.getByRole('button', { name: /save changes/i }));

    await waitFor(() => {
      expect(screen.getByText(/must be integer (>=|≥) 0/i)).not.toBeNull();
      expect(screen.queryByText(/classes attended must be a whole number/i)).toBeNull();
    });
    expect(api.put).not.toHaveBeenCalled();

    // Cancel edit to ensure the existing record is preserved
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
    await waitFor(() => {
      expect(screen.getByText('6 / 8')).not.toBeNull();
    });
  });

  test('validates attendance edit form with empty and invalid dates, preserving record', async () => {
    (api.get as any).mockImplementation((url: string) => {
      if (url === '/semesters/1') return Promise.resolve({ id: '1', name: 'Fall 2026' });
      if (url === '/subjects/2') return Promise.resolve({ id: '2', name: 'Math 101' });
      if (url === '/subjects/2/assessments') return Promise.resolve([]);
      if (url === '/subjects/2/attendance') return Promise.resolve([
        { id: 'att-edit', classes_attended: 6, classes_held: 8, recorded_on: '2026-09-01' }
      ]);
      return Promise.resolve(null);
    });

    render(<SubjectDetail />, { wrapper: Wrapper });
    await waitFor(() => expect(screen.getAllByTestId('attendance-pct').length).toBe(1));

    const editButton = screen.getByRole('button', { name: 'Edit attendance' });
    fireEvent.click(editButton);

    await waitFor(() => {
      expect((screen.getByLabelText(/date \*/i) as HTMLInputElement).value).toBe('2026-09-01');
    });

    // 1. Empty date
    fireEvent.change(screen.getByLabelText(/date \*/i), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: /save changes/i }));

    await waitFor(() => {
      expect(screen.getByText(/date is required/i)).not.toBeNull();
    });
    expect(api.put).not.toHaveBeenCalled();

    // 2. Invalid date format / out of bounds day (31-02-2026)
    fireEvent.change(screen.getByLabelText(/date \*/i), { target: { value: '31-02-2026' } });
    fireEvent.click(screen.getByRole('button', { name: /save changes/i }));

    await waitFor(() => {
      expect(screen.getByText(/please enter a valid date/i)).not.toBeNull();
      expect(screen.queryByText(/^date is required$/i)).toBeNull();
    });
    expect(api.put).not.toHaveBeenCalled();

    // 3. Invalid calendar date (2026-02-31)
    fireEvent.change(screen.getByLabelText(/date \*/i), { target: { value: '2026-02-31' } });
    fireEvent.click(screen.getByRole('button', { name: /save changes/i }));

    await waitFor(() => {
      expect(screen.getByText(/please enter a valid date/i)).not.toBeNull();
      expect(screen.queryByText(/^date is required$/i)).toBeNull();
    });
    expect(api.put).not.toHaveBeenCalled();

    // 4. Browser badInput behavior (when user inputs invalid date into native date picker)
    const dateInput = screen.getByLabelText(/date \*/i);
    Object.defineProperty(dateInput, 'validity', {
      configurable: true,
      value: { badInput: true }
    });
    fireEvent.change(dateInput, { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: /save changes/i }));

    await waitFor(() => {
      expect(screen.getByText(/please enter a valid date/i)).not.toBeNull();
      expect(screen.queryByText(/^date is required$/i)).toBeNull();
    });
    expect(api.put).not.toHaveBeenCalled();

    // Reset validity and cancel
    Object.defineProperty(dateInput, 'validity', {
      configurable: true,
      value: { badInput: false }
    });
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));

    // Verify existing record is preserved
    await waitFor(() => {
      expect(screen.getByText('6 / 8')).not.toBeNull();
      expect(screen.getByText(/recorded on 2026-09-01/i)).not.toBeNull();
    });
  });

  test('deletes attendance successfully', async () => {
    (api.get as any).mockImplementation((url: string) => {
      if (url === '/semesters/1') return Promise.resolve({ id: '1', name: 'Fall 2026' });
      if (url === '/subjects/2') return Promise.resolve({ id: '2', name: 'Math 101' });
      if (url === '/subjects/2/assessments') return Promise.resolve([]);
      if (url === '/subjects/2/attendance') return Promise.resolve([
        { id: 'att-del', classes_attended: 1, classes_held: 1, recorded_on: '2026-09-01' }
      ]);
      return Promise.resolve(null);
    });

    (api.delete as any).mockResolvedValueOnce(null);
    window.confirm = vi.fn().mockReturnValue(true);

    render(<SubjectDetail />, { wrapper: Wrapper });

    await waitFor(() => expect(screen.getAllByTestId('attendance-pct').length).toBe(1));

    const deleteButton = screen.getByRole('button', { name: 'Delete attendance' });
    fireEvent.click(deleteButton);

    await waitFor(() => {
      expect(api.delete).toHaveBeenCalledWith('/attendance/att-del');
      expect(window.confirm).toHaveBeenCalled();
    });
  });
});

describe('SubjectDetail - Assessments', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queryClient.clear();
    window.history.pushState({}, 'Test', '/app/semesters/1/subjects/2');

    (api.get as any).mockImplementation((url: string) => {
      if (url === '/semesters/1') return Promise.resolve({ id: '1', name: 'Fall 2026' });
      if (url === '/subjects/2') return Promise.resolve({ id: '2', name: 'Math 101', code: 'M101' });
      if (url === '/subjects/2/assessments') return Promise.resolve([]);
      if (url === '/subjects/2/attendance') return Promise.resolve([]);
      return Promise.resolve(null);
    });
  });

  test('renders subject details and empty assessments state', async () => {
    render(<SubjectDetail />, { wrapper: Wrapper });

    await waitFor(() => {
      expect(screen.getByText('Math 101 (M101)')).not.toBeNull();
      expect(screen.getByText('Fall 2026 • Subject Details')).not.toBeNull();
      expect(screen.getByText('No assessments')).not.toBeNull();
    });
  });

  test('renders assessment list', async () => {
    (api.get as any).mockImplementation((url: string) => {
      if (url === '/semesters/1') return Promise.resolve({ id: '1', name: 'Fall 2026' });
      if (url === '/subjects/2') return Promise.resolve({ id: '2', name: 'Math 101' });
      if (url === '/subjects/2/attendance') return Promise.resolve([]);
      if (url === '/subjects/2/assessments') return Promise.resolve([
        { id: '10', name: 'Midterm', category: 'midsem', max_marks: 100, marks: 85, weightage: 30, status: 'scored' },
        { id: '11', name: 'Final', category: 'endsem', max_marks: 100, marks: null, weightage: 40, status: 'pending' },
        { id: '12', name: 'Quiz 1', category: 'quiz', max_marks: 10, marks: 0, weightage: 5, status: 'scored' }
      ]);
      return Promise.resolve(null);
    });

    render(<SubjectDetail />, { wrapper: Wrapper });

    await waitFor(() => {
      expect(screen.getByText('Midterm')).not.toBeNull();
    });

    const marksEls = screen.getAllByTestId('assessment-marks');

    // Midterm (Scored)
    expect(marksEls[0].textContent).toContain('85');

    // Final (Pending, null marks)
    expect(screen.getByText('Final')).not.toBeNull();
    expect(marksEls[1].textContent).toContain('--');
    expect(screen.getByText('PENDING')).not.toBeNull();

    // Quiz 1 (Scored, 0 marks - genuine zero)
    expect(screen.getByText('Quiz 1')).not.toBeNull();
    expect(marksEls[2].textContent).toContain('0');

    expect(screen.getAllByText('SCORED').length).toBe(2);
  });

  test('validates assessment creation form', async () => {
    render(<SubjectDetail />, { wrapper: Wrapper });

    await waitFor(() => expect(screen.getByText('No assessments')).not.toBeNull());

    fireEvent.click(screen.getByRole('button', { name: /add assessment/i }));
    fireEvent.click(screen.getByRole('button', { name: /create assessment/i }));

    await waitFor(() => {
      expect(screen.getByText(/name is required/i)).not.toBeNull();
      expect(screen.getByText(/category is required/i)).not.toBeNull();
      expect(screen.getByText(/max marks is required/i)).not.toBeNull();
    });

    // Test custom validation
    fireEvent.change(screen.getByLabelText(/max marks \*/i), { target: { value: '100' } });
    fireEvent.change(screen.getByLabelText(/^marks/i), { target: { value: '150' } });
    fireEvent.change(screen.getByLabelText(/weightage/i), { target: { value: '150' } });

    fireEvent.click(screen.getByRole('button', { name: /create assessment/i }));

    await waitFor(() => {
      expect(screen.getByText(/marks must be between 0 and 100/i)).not.toBeNull();
      expect(screen.getByText(/weightage must be between 0 and 100/i)).not.toBeNull();
    });
  });

  test('creates assessment successfully', async () => {
    (api.post as any).mockResolvedValueOnce({ id: '20' });

    render(<SubjectDetail />, { wrapper: Wrapper });

    await waitFor(() => expect(screen.getByText('No assessments')).not.toBeNull());

    fireEvent.click(screen.getByRole('button', { name: /add assessment/i }));

    fireEvent.change(screen.getByLabelText(/assessment name \*/i), { target: { value: 'Assignment 1' } });
    fireEvent.change(screen.getByLabelText(/category \*/i), { target: { value: 'assignment' } });
    fireEvent.change(screen.getByLabelText(/max marks \*/i), { target: { value: '50' } });
    fireEvent.change(screen.getByLabelText(/^status/i), { target: { value: 'pending' } });
    // Empty marks should send null

    fireEvent.click(screen.getByRole('button', { name: /create assessment/i }));

    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith('/subjects/2/assessments', {
        name: 'Assignment 1',
        category: 'assignment',
        max_marks: 50,
        status: 'pending',
        marks: null,
        weightage: null,
        scheduled_at: null,
      });
    });
  });

  test('validates scored assessment must have marks', async () => {
    render(<SubjectDetail />, { wrapper: Wrapper });

    await waitFor(() => expect(screen.getByText('No assessments')).not.toBeNull());

    fireEvent.click(screen.getByRole('button', { name: /add assessment/i }));

    fireEvent.change(screen.getByLabelText(/assessment name \*/i), { target: { value: 'Assignment 1' } });
    fireEvent.change(screen.getByLabelText(/category \*/i), { target: { value: 'assignment' } });
    fireEvent.change(screen.getByLabelText(/max marks \*/i), { target: { value: '50' } });

    // Set status to scored but leave marks blank
    fireEvent.change(screen.getByLabelText(/^status/i), { target: { value: 'scored' } });

    fireEvent.click(screen.getByRole('button', { name: /create assessment/i }));

    await waitFor(() => {
      expect(screen.getByText(/marks are required when status is 'scored'/i)).not.toBeNull();
    });
  });

  test('updates assessment successfully', async () => {
    (api.get as any).mockImplementation((url: string) => {
      if (url === '/semesters/1') return Promise.resolve({ id: '1', name: 'Fall 2026' });
      if (url === '/subjects/2') return Promise.resolve({ id: '2', name: 'Math' });
      if (url === '/subjects/2/attendance') return Promise.resolve([]);
      if (url === '/subjects/2/assessments') return Promise.resolve([
        { id: '10', name: 'Midterm', category: 'midsem', max_marks: 100, marks: null, weightage: 30, status: 'pending' }
      ]);
      return Promise.resolve(null);
    });

    (api.put as any).mockResolvedValueOnce({ id: '10' });

    render(<SubjectDetail />, { wrapper: Wrapper });

    await waitFor(() => expect(screen.getByText('Midterm')).not.toBeNull());

    // Click edit button
    const editButton = screen.getByRole('button', { name: 'Edit assessment' });
    fireEvent.click(editButton);

    await waitFor(() => {
      expect((screen.getByLabelText(/assessment name \*/i) as HTMLInputElement).value).toBe('Midterm');
    });

    fireEvent.change(screen.getByLabelText(/^marks/i), { target: { value: '95' } });
    fireEvent.change(screen.getByLabelText(/^status/i), { target: { value: 'scored' } });

    fireEvent.click(screen.getByRole('button', { name: /save changes/i }));

    await waitFor(() => {
      expect(api.put).toHaveBeenCalledWith('/assessments/10', {
        name: 'Midterm',
        category: 'midsem',
        max_marks: 100,
        status: 'scored',
        marks: 95,
        weightage: 30,
        scheduled_at: null,
      });
    });
  });

  test('renders all 9 canonical category options in assessment form dropdown', async () => {
    render(<SubjectDetail />, { wrapper: Wrapper });

    await waitFor(() => expect(screen.getByText('No assessments')).not.toBeNull());

    fireEvent.click(screen.getByRole('button', { name: /add assessment/i }));

    const categorySelect = screen.getByLabelText(/category \*/i) as HTMLSelectElement;
    expect(categorySelect.tagName).toBe('SELECT');

    const options = Array.from(categorySelect.options).map((opt) => ({
      value: opt.value,
      label: opt.text,
    }));

    expect(options).toEqual([
      { value: '', label: 'Select a category' },
      { value: 'internal_test', label: 'Internal Test' },
      { value: 'assignment', label: 'Assignment' },
      { value: 'quiz', label: 'Quiz' },
      { value: 'practical', label: 'Practical / Lab' },
      { value: 'viva', label: 'Viva / Oral' },
      { value: 'project', label: 'Project' },
      { value: 'midsem', label: 'Midterm Exam' },
      { value: 'endsem', label: 'Final / Endsem Exam' },
      { value: 'other', label: 'Other' },
    ]);
  });

  test('displays assessment creation API error directly inside form and preserves entered values', async () => {
    (api.post as any).mockRejectedValueOnce({
      data: { detail: 'Database constraint violation' },
      message: 'Database constraint violation',
    });

    render(<SubjectDetail />, { wrapper: Wrapper });

    await waitFor(() => expect(screen.getByText('No assessments')).not.toBeNull());

    fireEvent.click(screen.getByRole('button', { name: /add assessment/i }));

    fireEvent.change(screen.getByLabelText(/assessment name \*/i), { target: { value: 'Digital Electronics Test 1' } });
    fireEvent.change(screen.getByLabelText(/category \*/i), { target: { value: 'internal_test' } });
    fireEvent.change(screen.getByLabelText(/max marks \*/i), { target: { value: '25' } });
    fireEvent.change(screen.getByLabelText(/weightage/i), { target: { value: '20' } });
    fireEvent.change(screen.getByLabelText(/date/i), { target: { value: '2026-11-03' } });
    fireEvent.change(screen.getByLabelText(/^status/i), { target: { value: 'scored' } });
    fireEvent.change(screen.getByLabelText(/^marks/i), { target: { value: '20' } });

    fireEvent.click(screen.getByRole('button', { name: /create assessment/i }));

    await waitFor(() => {
      const alert = screen.getByRole('alert');
      expect(alert).not.toBeNull();
      expect(alert.textContent).toContain('Database constraint violation');
    });

    // Form remains open and entered values are preserved
    expect(screen.getByRole('heading', { name: /create new assessment/i })).not.toBeNull();
    expect((screen.getByLabelText(/assessment name \*/i) as HTMLInputElement).value).toBe('Digital Electronics Test 1');
    expect((screen.getByLabelText(/category \*/i) as HTMLSelectElement).value).toBe('internal_test');
    expect((screen.getByLabelText(/max marks \*/i) as HTMLInputElement).value).toBe('25');
    expect((screen.getByLabelText(/weightage/i) as HTMLInputElement).value).toBe('20');
    expect((screen.getByLabelText(/date/i) as HTMLInputElement).value).toBe('2026-11-03');
    expect((screen.getByLabelText(/^status/i) as HTMLSelectElement).value).toBe('scored');
    expect((screen.getByLabelText(/^marks/i) as HTMLInputElement).value).toBe('20');
  });

  test('displays inline validation when creating duplicate assessment name within same subject', async () => {
    (api.get as any).mockImplementation((url: string) => {
      if (url === '/semesters/1') return Promise.resolve({ id: '1', name: 'Fall 2026' });
      if (url === '/subjects/2') return Promise.resolve({ id: '2', name: 'Digital Electronics' });
      if (url === '/subjects/2/attendance') return Promise.resolve([]);
      if (url === '/subjects/2/assessments') return Promise.resolve([
        { id: '10', name: 'Digital Electronics Test 1', category: 'internal_test', max_marks: 25, marks: 20, weightage: 20, status: 'scored' }
      ]);
      return Promise.resolve(null);
    });

    render(<SubjectDetail />, { wrapper: Wrapper });

    await waitFor(() => expect(screen.getByText('Digital Electronics Test 1')).not.toBeNull());

    fireEvent.click(screen.getByRole('button', { name: /add assessment/i }));

    fireEvent.change(screen.getByLabelText(/assessment name \*/i), { target: { value: 'Digital Electronics Test 1' } });
    fireEvent.change(screen.getByLabelText(/category \*/i), { target: { value: 'internal_test' } });
    fireEvent.change(screen.getByLabelText(/max marks \*/i), { target: { value: '25' } });

    fireEvent.click(screen.getByRole('button', { name: /create assessment/i }));

    await waitFor(() => {
      expect(screen.getByText('An assessment with this name already exists in this subject')).not.toBeNull();
    });

    expect(api.post).not.toHaveBeenCalled();
  });

  test('detects duplicate assessment name case-insensitively and with trimmed whitespace', async () => {
    (api.get as any).mockImplementation((url: string) => {
      if (url === '/semesters/1') return Promise.resolve({ id: '1', name: 'Fall 2026' });
      if (url === '/subjects/2') return Promise.resolve({ id: '2', name: 'Digital Electronics' });
      if (url === '/subjects/2/attendance') return Promise.resolve([]);
      if (url === '/subjects/2/assessments') return Promise.resolve([
        { id: '10', name: 'Digital Electronics Test 1', category: 'internal_test', max_marks: 25, marks: 20, weightage: 20, status: 'scored' }
      ]);
      return Promise.resolve(null);
    });

    render(<SubjectDetail />, { wrapper: Wrapper });

    await waitFor(() => expect(screen.getByText('Digital Electronics Test 1')).not.toBeNull());

    fireEvent.click(screen.getByRole('button', { name: /add assessment/i }));

    // Test with mixed casing and leading/trailing whitespace
    fireEvent.change(screen.getByLabelText(/assessment name \*/i), { target: { value: '   digital electronics test 1   ' } });
    fireEvent.change(screen.getByLabelText(/category \*/i), { target: { value: 'internal_test' } });
    fireEvent.change(screen.getByLabelText(/max marks \*/i), { target: { value: '25' } });

    fireEvent.click(screen.getByRole('button', { name: /create assessment/i }));

    await waitFor(() => {
      expect(screen.getByText('An assessment with this name already exists in this subject')).not.toBeNull();
    });

    expect(api.post).not.toHaveBeenCalled();
  });

  test('allows editing an assessment while retaining its existing name', async () => {
    (api.get as any).mockImplementation((url: string) => {
      if (url === '/semesters/1') return Promise.resolve({ id: '1', name: 'Fall 2026' });
      if (url === '/subjects/2') return Promise.resolve({ id: '2', name: 'Digital Electronics' });
      if (url === '/subjects/2/attendance') return Promise.resolve([]);
      if (url === '/subjects/2/assessments') return Promise.resolve([
        { id: '10', name: 'Digital Electronics Test 1', category: 'internal_test', max_marks: 25, marks: null, weightage: 20, status: 'pending' }
      ]);
      return Promise.resolve(null);
    });

    (api.put as any).mockResolvedValueOnce({ id: '10' });

    render(<SubjectDetail />, { wrapper: Wrapper });

    await waitFor(() => expect(screen.getByText('Digital Electronics Test 1')).not.toBeNull());

    const editBtn = screen.getByRole('button', { name: 'Edit assessment' });
    fireEvent.click(editBtn);

    await waitFor(() => {
      expect((screen.getByLabelText(/assessment name \*/i) as HTMLInputElement).value).toBe('Digital Electronics Test 1');
    });

    // Update marks and status while leaving name intact
    fireEvent.change(screen.getByLabelText(/^status/i), { target: { value: 'scored' } });
    fireEvent.change(screen.getByLabelText(/^marks/i), { target: { value: '22' } });

    fireEvent.click(screen.getByRole('button', { name: /save changes/i }));

    await waitFor(() => {
      expect(api.put).toHaveBeenCalledWith('/assessments/10', expect.objectContaining({
        name: 'Digital Electronics Test 1',
        status: 'scored',
        marks: 22,
      }));
    });

    expect(screen.queryByText('An assessment with this name already exists in this subject')).toBeNull();
  });

  test('rejects editing an assessment when renamed to another existing assessment in same subject', async () => {
    (api.get as any).mockImplementation((url: string) => {
      if (url === '/semesters/1') return Promise.resolve({ id: '1', name: 'Fall 2026' });
      if (url === '/subjects/2') return Promise.resolve({ id: '2', name: 'Digital Electronics' });
      if (url === '/subjects/2/attendance') return Promise.resolve([]);
      if (url === '/subjects/2/assessments') return Promise.resolve([
        { id: '10', name: 'Test 1', category: 'internal_test', max_marks: 25, marks: null, weightage: 20, status: 'pending' },
        { id: '11', name: 'Test 2', category: 'internal_test', max_marks: 25, marks: null, weightage: 20, status: 'pending' },
      ]);
      return Promise.resolve(null);
    });

    render(<SubjectDetail />, { wrapper: Wrapper });

    await waitFor(() => expect(screen.getByText('Test 1')).not.toBeNull());

    const editBtns = screen.getAllByRole('button', { name: 'Edit assessment' });
    // Click edit on Test 2 (second button)
    fireEvent.click(editBtns[1]);

    await waitFor(() => {
      expect((screen.getByLabelText(/assessment name \*/i) as HTMLInputElement).value).toBe('Test 2');
    });

    // Rename Test 2 to "  test 1  "
    fireEvent.change(screen.getByLabelText(/assessment name \*/i), { target: { value: '  test 1  ' } });

    fireEvent.click(screen.getByRole('button', { name: /save changes/i }));

    await waitFor(() => {
      expect(screen.getByText('An assessment with this name already exists in this subject')).not.toBeNull();
    });

    expect(api.put).not.toHaveBeenCalled();
  });

  test('handles backend HTTP 409 response gracefully on assessment creation', async () => {
    (api.get as any).mockImplementation((url: string) => {
      if (url === '/semesters/1') return Promise.resolve({ id: '1', name: 'Fall 2026' });
      if (url === '/subjects/2') return Promise.resolve({ id: '2', name: 'Digital Electronics' });
      if (url === '/subjects/2/attendance') return Promise.resolve([]);
      if (url === '/subjects/2/assessments') return Promise.resolve([]);
      return Promise.resolve(null);
    });

    (api.post as any).mockRejectedValueOnce({
      status: 409,
      data: { detail: 'An assessment with this name already exists in this subject' },
      message: 'An assessment with this name already exists in this subject',
    });

    render(<SubjectDetail />, { wrapper: Wrapper });

    await waitFor(() => expect(screen.getByText('No assessments')).not.toBeNull());

    fireEvent.click(screen.getByRole('button', { name: /add assessment/i }));

    fireEvent.change(screen.getByLabelText(/assessment name \*/i), { target: { value: 'Digital Electronics Test 1' } });
    fireEvent.change(screen.getByLabelText(/category \*/i), { target: { value: 'internal_test' } });
    fireEvent.change(screen.getByLabelText(/max marks \*/i), { target: { value: '25' } });

    fireEvent.click(screen.getByRole('button', { name: /create assessment/i }));

    await waitFor(() => {
      expect(screen.getAllByText('An assessment with this name already exists in this subject').length).toBeGreaterThan(0);
    });

    // Form stays open with input value preserved
    expect(screen.getByRole('heading', { name: /create new assessment/i })).not.toBeNull();
    expect((screen.getByLabelText(/assessment name \*/i) as HTMLInputElement).value).toBe('Digital Electronics Test 1');
  });

  test('attendance form defaults to local date, not UTC date', async () => {
    // Mock the date to be exactly on a boundary where UTC and local date differ
    // Example: 2026-09-01T22:00:00.000-05:00 (EST) -> UTC is 2026-09-02T03:00:00.000Z
    // So local date is 2026-09-01, but UTC date is 2026-09-02
    vi.useFakeTimers({ toFake: ['Date'] });
    const mockDate = new Date('2026-09-01T22:00:00.000-05:00');
    vi.setSystemTime(mockDate);

    (api.get as any).mockImplementation((url: string) => {
      if (url === '/semesters/1') return Promise.resolve({ id: '1', name: 'Fall 2026' });
      if (url === '/subjects/2') return Promise.resolve({ id: '2', name: 'Math 101' });
      if (url === '/subjects/2/assessments') return Promise.resolve([]);
      if (url === '/subjects/2/attendance') return Promise.resolve([]);
      return Promise.resolve(null);
    });

    render(<SubjectDetail />, { wrapper: Wrapper });

    // Wait for empty state
    await waitFor(() => expect(screen.getByText('No attendance recorded')).not.toBeNull());

    // Click Record Attendance to open form
    fireEvent.click(screen.getByRole('button', { name: /record attendance/i }));

    // Check the default date value matches the LOCAL date of the mocked time
    await waitFor(() => {
      const dateInput = screen.getByLabelText(/date \*/i) as HTMLInputElement;
      const expectedLocal = `${mockDate.getFullYear()}-${String(mockDate.getMonth() + 1).padStart(2, '0')}-${String(mockDate.getDate()).padStart(2, '0')}`;
      expect(dateInput.value).toBe(expectedLocal);
    });

    vi.useRealTimers();
  });

  describe('SubjectDetail - Calculator', () => {
    beforeEach(() => {
      (api.get as any).mockImplementation((url: string) => {
        if (url === '/semesters/1') return Promise.resolve({ id: '1', name: 'Fall 2026' });
        if (url === '/subjects/2') return Promise.resolve({ id: '2', name: 'Math 101' });
        if (url === '/subjects/2/assessments') return Promise.resolve([]);
        if (url === '/subjects/2/attendance') return Promise.resolve([]);
        return Promise.resolve(null);
      });
    });

    test('validates calculator target input for -1, 101, 0, and 100', async () => {
      render(<SubjectDetail />, { wrapper: Wrapper });
      await waitFor(() => expect(screen.getByText('Required-Score Calculator')).not.toBeNull());

      fireEvent.click(screen.getByRole('button', { name: /calculate/i }));

      await waitFor(() => {
        expect(screen.getByText('Target percentage is required')).not.toBeNull();
      });

      // -1 should be rejected inline and not trigger API call
      fireEvent.change(screen.getByLabelText(/target percentage/i), { target: { value: '-1' } });
      fireEvent.click(screen.getByRole('button', { name: /calculate/i }));

      await waitFor(() => {
        expect(screen.getByText('Target percentage must be between 0 and 100')).not.toBeNull();
      });
      expect(api.post).not.toHaveBeenCalledWith('/subjects/2/calculate-required', expect.anything());

      // 101 should be rejected inline and not trigger API call
      fireEvent.change(screen.getByLabelText(/target percentage/i), { target: { value: '101' } });
      fireEvent.click(screen.getByRole('button', { name: /calculate/i }));

      await waitFor(() => {
        expect(screen.getByText('Target percentage must be between 0 and 100')).not.toBeNull();
      });
      expect(api.post).not.toHaveBeenCalledWith('/subjects/2/calculate-required', expect.anything());

      // 0 should be accepted and trigger API call
      (api.post as any).mockResolvedValueOnce({
        earned_points: 0.0,
        remaining_weight: 100.0,
        total_valid_weight: 100.0,
        target_achieved: true,
        impossible: false,
        required_remaining_percentage: 0.0,
        required_points_from_remaining: 0.0,
      });
      fireEvent.change(screen.getByLabelText(/target percentage/i), { target: { value: '0' } });
      fireEvent.click(screen.getByRole('button', { name: /calculate/i }));

      await waitFor(() => {
        expect(api.post).toHaveBeenCalledWith('/subjects/2/calculate-required', { target_percentage: 0 });
      });

      // 100 should be accepted and trigger API call
      (api.post as any).mockResolvedValueOnce({
        earned_points: 0.0,
        remaining_weight: 100.0,
        total_valid_weight: 100.0,
        target_achieved: false,
        impossible: false,
        required_remaining_percentage: 100.0,
        required_points_from_remaining: 100.0,
      });
      fireEvent.change(screen.getByLabelText(/target percentage/i), { target: { value: '100' } });
      fireEvent.click(screen.getByRole('button', { name: /calculate/i }));

      await waitFor(() => {
        expect(api.post).toHaveBeenCalledWith('/subjects/2/calculate-required', { target_percentage: 100 });
      });
    });

    test('calculates achievable target successfully', async () => {
      (api.post as any).mockResolvedValueOnce({
        earned_points: 15.0,
        remaining_weight: 80.0,
        total_valid_weight: 100.0,
        target_achieved: false,
        impossible: false,
        required_remaining_percentage: 75.0,
        required_points_from_remaining: 60.0
      });

      render(<SubjectDetail />, { wrapper: Wrapper });
      await waitFor(() => expect(screen.getByText('Required-Score Calculator')).not.toBeNull());

      fireEvent.change(screen.getByLabelText(/target percentage/i), { target: { value: '75' } });
      fireEvent.click(screen.getByRole('button', { name: /calculate/i }));

      await waitFor(() => {
        expect(screen.getByText(/Calculation Result for 75%/)).not.toBeNull();
        expect(screen.getByText(/75.00%/)).not.toBeNull();
        expect(screen.getByText(/60.00 more points out of the 80.00% remaining weight/)).not.toBeNull();
      });

      expect(api.post).toHaveBeenCalledWith('/subjects/2/calculate-required', { target_percentage: 75 });
    });

    test('displays impossible target result', async () => {
      (api.post as any).mockResolvedValueOnce({
        earned_points: 0.0,
        remaining_weight: 50.0,
        total_valid_weight: 100.0,
        target_achieved: false,
        impossible: true,
        required_remaining_percentage: 150.0,
        required_points_from_remaining: 75.0
      });

      render(<SubjectDetail />, { wrapper: Wrapper });
      await waitFor(() => expect(screen.getByText('Required-Score Calculator')).not.toBeNull());

      fireEvent.change(screen.getByLabelText(/target percentage/i), { target: { value: '75' } });
      fireEvent.click(screen.getByRole('button', { name: /calculate/i }));

      await waitFor(() => {
        expect(screen.getByText(/It is impossible to reach this target/)).not.toBeNull();
        expect(screen.getAllByText(/Maximum Achievable Score/i).length).toBeGreaterThanOrEqual(1);
        expect(screen.getAllByText(/50\.00%/).length).toBeGreaterThanOrEqual(1);
        expect(screen.getByText(/How this is calculated/i)).not.toBeNull();
      });
    });

    test('displays impossible target explanation when remaining weight is zero', async () => {
      (api.post as any).mockResolvedValueOnce({
        earned_points: 60.0,
        remaining_weight: 0.0,
        total_valid_weight: 100.0,
        target_achieved: false,
        impossible: true,
        required_remaining_percentage: 0.0,
        required_points_from_remaining: 15.0,
        max_achievable_score: 60.0
      });

      render(<SubjectDetail />, { wrapper: Wrapper });
      await waitFor(() => expect(screen.getByText('Required-Score Calculator')).not.toBeNull());

      fireEvent.change(screen.getByLabelText(/target percentage/i), { target: { value: '75' } });
      fireEvent.click(screen.getByRole('button', { name: /calculate/i }));

      await waitFor(() => {
        expect(screen.getByText(/It is impossible to reach this target/)).not.toBeNull();
        expect(screen.getByText('60.00%')).not.toBeNull();
        expect(screen.getByText(/All non-exempt coursework assessments have already been completed or evaluated/i)).not.toBeNull();
      });
    });

    test('displays already-achieved target result', async () => {
      (api.post as any).mockResolvedValueOnce({
        earned_points: 80.0,
        remaining_weight: 0.0,
        total_valid_weight: 100.0,
        target_achieved: true,
        impossible: false,
        required_remaining_percentage: 0.0,
        required_points_from_remaining: -5.0
      });

      render(<SubjectDetail />, { wrapper: Wrapper });
      await waitFor(() => expect(screen.getByText('Required-Score Calculator')).not.toBeNull());

      fireEvent.change(screen.getByLabelText(/target percentage/i), { target: { value: '75' } });
      fireEvent.click(screen.getByRole('button', { name: /calculate/i }));

      await waitFor(() => {
        expect(screen.getByText(/You have already achieved this target score/)).not.toBeNull();
      });
    });
  });

  describe('SubjectDetail - Subject Editing', () => {
    beforeEach(() => {
      vi.clearAllMocks();
      queryClient.clear();
      window.history.pushState({}, 'Test', '/app/semesters/1/subjects/2');

      (api.get as any).mockImplementation((url: string) => {
        if (url === '/semesters/1') return Promise.resolve({ id: '1', name: 'Fall 2026' });
        if (url === '/subjects/2') {
          return Promise.resolve({
            id: '2',
            name: 'Math 101',
            code: 'M101',
            credits: 3.0,
            target_percentage: 85,
            semester_id: '1',
          });
        }
        if (url === '/subjects/2/assessments') return Promise.resolve([]);
        if (url === '/subjects/2/attendance') return Promise.resolve([]);
        return Promise.resolve(null);
      });
    });

    test('edit subject button opens form and prepopulates existing values', async () => {
      render(<SubjectDetail />, { wrapper: Wrapper });

      await waitFor(() => {
        expect(screen.getByText(/Math 101/)).not.toBeNull();
      });

      const editBtn = screen.getByRole('button', { name: /edit subject/i });
      fireEvent.click(editBtn);

      await waitFor(() => {
        expect(screen.getByRole('heading', { name: /edit subject/i })).not.toBeNull();
      });

      expect((screen.getByLabelText(/subject name \*/i) as HTMLInputElement).value).toBe('Math 101');
      expect((screen.getByLabelText(/course code/i) as HTMLInputElement).value).toBe('M101');
      expect((screen.getByLabelText(/credits/i) as HTMLInputElement).value).toBe('3');
      expect((screen.getByLabelText(/target percentage \(%\)/i) as HTMLInputElement).value).toBe('85');
    });

    test('submits valid changes and updates details on success', async () => {
      let currentSubject = {
        id: '2',
        name: 'Math 101',
        code: 'M101',
        credits: 3.0,
        target_percentage: 85,
        semester_id: '1',
      };

      (api.get as any).mockImplementation((url: string) => {
        if (url === '/semesters/1') return Promise.resolve({ id: '1', name: 'Fall 2026' });
        if (url === '/subjects/2') return Promise.resolve(currentSubject);
        if (url === '/subjects/2/assessments') return Promise.resolve([]);
        if (url === '/subjects/2/attendance') return Promise.resolve([]);
        return Promise.resolve(null);
      });

      (api.put as any).mockImplementation((_url: string, data: any) => {
        currentSubject = { ...currentSubject, ...data };
        return Promise.resolve(currentSubject);
      });

      render(<SubjectDetail />, { wrapper: Wrapper });

      await waitFor(() => {
        expect(screen.getByText(/Math 101/)).not.toBeNull();
      });

      fireEvent.click(screen.getByRole('button', { name: /edit subject/i }));

      fireEvent.change(screen.getByLabelText(/subject name \*/i), { target: { value: 'Advanced Math' } });
      fireEvent.change(screen.getByLabelText(/course code/i), { target: { value: 'AM201' } });
      fireEvent.change(screen.getByLabelText(/credits/i), { target: { value: '4.0' } });
      fireEvent.change(screen.getByLabelText(/target percentage \(%\)/i), { target: { value: '90' } });

      fireEvent.click(screen.getByRole('button', { name: /save changes/i }));

      await waitFor(() => {
        expect(api.put).toHaveBeenCalledWith('/subjects/2', {
          name: 'Advanced Math',
          code: 'AM201',
          credits: 4.0,
          target_percentage: 90,
        });
      });

      // Edit form closes and header reflects updated data
      await waitFor(() => {
        expect(screen.queryByRole('heading', { name: /edit subject/i })).toBeNull();
        expect(screen.getByText(/Advanced Math \(AM201\)/)).not.toBeNull();
        expect(screen.getByText(/4 Credits/)).not.toBeNull();
        expect(screen.getByText(/Target: 90%/)).not.toBeNull();
      });
    });

    test('cancel discards unsaved changes and closes form', async () => {
      render(<SubjectDetail />, { wrapper: Wrapper });

      await waitFor(() => {
        expect(screen.getByText(/Math 101/)).not.toBeNull();
      });

      fireEvent.click(screen.getByRole('button', { name: /edit subject/i }));

      fireEvent.change(screen.getByLabelText(/subject name \*/i), { target: { value: 'Discarded Name' } });
      fireEvent.click(screen.getByRole('button', { name: /cancel/i }));

      // Form is closed and original heading remains
      expect(screen.queryByRole('heading', { name: /edit subject/i })).toBeNull();
      expect(screen.getByText(/Math 101 \(M101\)/)).not.toBeNull();

      // Opening again shows original values
      fireEvent.click(screen.getByRole('button', { name: /edit subject/i }));
      expect((screen.getByLabelText(/subject name \*/i) as HTMLInputElement).value).toBe('Math 101');
    });

    test('validates inputs: requires name, non-negative credits, integer target percentage 0-100', async () => {
      render(<SubjectDetail />, { wrapper: Wrapper });

      await waitFor(() => {
        expect(screen.getByText(/Math 101/)).not.toBeNull();
      });

      fireEvent.click(screen.getByRole('button', { name: /edit subject/i }));

      fireEvent.change(screen.getByLabelText(/subject name \*/i), { target: { value: '' } });
      fireEvent.change(screen.getByLabelText(/credits/i), { target: { value: '-2' } });
      fireEvent.change(screen.getByLabelText(/target percentage \(%\)/i), { target: { value: '150' } });

      fireEvent.click(screen.getByRole('button', { name: /save changes/i }));

      await waitFor(() => {
        expect(screen.getByText(/name is required/i)).not.toBeNull();
        expect(screen.getByText(/credits must be >= 0/i)).not.toBeNull();
        expect(screen.getByText(/target percentage must be an integer between 0 and 100/i)).not.toBeNull();
      });

      expect(api.put).not.toHaveBeenCalled();
    });

    test('displays API errors inside the form and preserves entered values', async () => {
      (api.put as any).mockRejectedValueOnce({
        data: { detail: 'Subject update failed on server' },
        message: 'Subject update failed on server',
      });

      render(<SubjectDetail />, { wrapper: Wrapper });

      await waitFor(() => {
        expect(screen.getByText(/Math 101/)).not.toBeNull();
      });

      fireEvent.click(screen.getByRole('button', { name: /edit subject/i }));

      fireEvent.change(screen.getByLabelText(/subject name \*/i), { target: { value: 'Failing Subject' } });
      fireEvent.change(screen.getByLabelText(/course code/i), { target: { value: 'FAIL101' } });

      fireEvent.click(screen.getByRole('button', { name: /save changes/i }));

      await waitFor(() => {
        const alert = screen.getByRole('alert');
        expect(alert).not.toBeNull();
        expect(alert.textContent).toContain('Subject update failed on server');
      });

      // Form remains open and entered values are preserved
      expect(screen.getByRole('heading', { name: /edit subject/i })).not.toBeNull();
      expect((screen.getByLabelText(/subject name \*/i) as HTMLInputElement).value).toBe('Failing Subject');
      expect((screen.getByLabelText(/course code/i) as HTMLInputElement).value).toBe('FAIL101');
    });
  });

  describe('Assessment Status and Numeric Increments', () => {
    test('automatically switches status to scored when entering marks for pending assessment', async () => {
      render(<SubjectDetail />, { wrapper: Wrapper });
      await waitFor(() => {
        expect(screen.getByText(/Math 101/)).not.toBeNull();
      });

      fireEvent.click(screen.getByRole('button', { name: /add assessment/i }));

      const statusSelect = screen.getByLabelText(/^status$/i) as HTMLSelectElement;
      expect(statusSelect.value).toBe('pending');

      const marksInput = screen.getByLabelText(/^marks$/i) as HTMLInputElement;
      fireEvent.change(marksInput, { target: { value: '20.5' } });

      await waitFor(() => {
        expect(statusSelect.value).toBe('scored');
      });
    });

    test('clears marks when status is changed to pending, absent, or exempt', async () => {
      render(<SubjectDetail />, { wrapper: Wrapper });
      await waitFor(() => {
        expect(screen.getByText(/Math 101/)).not.toBeNull();
      });

      fireEvent.click(screen.getByRole('button', { name: /add assessment/i }));

      const statusSelect = screen.getByLabelText(/^status$/i) as HTMLSelectElement;
      const marksInput = screen.getByLabelText(/^marks$/i) as HTMLInputElement;

      // Set to scored and enter marks
      act(() => {
        fireEvent.change(statusSelect, { target: { value: 'scored' } });
        fireEvent.change(marksInput, { target: { value: '25' } });
      });
      expect(marksInput.value).toBe('25');

      // Change to pending -> marks cleared
      act(() => {
        fireEvent.change(statusSelect, { target: { value: 'pending' } });
      });
      expect(marksInput.value).toBe('');

      // Set to scored and enter marks again
      act(() => {
        fireEvent.change(statusSelect, { target: { value: 'scored' } });
        fireEvent.change(marksInput, { target: { value: '15' } });
      });
      expect(marksInput.value).toBe('15');

      // Change to absent -> marks cleared
      act(() => {
        fireEvent.change(statusSelect, { target: { value: 'absent' } });
      });
      expect(marksInput.value).toBe('');

      // Set to scored and enter marks again
      act(() => {
        fireEvent.change(statusSelect, { target: { value: 'scored' } });
        fireEvent.change(marksInput, { target: { value: '18' } });
      });
      expect(marksInput.value).toBe('18');

      // Change to exempt -> marks cleared
      act(() => {
        fireEvent.change(statusSelect, { target: { value: 'exempt' } });
      });
      expect(marksInput.value).toBe('');
    });

    test('validates exempt assessment must not contain marks', async () => {
      render(<SubjectDetail />, { wrapper: Wrapper });
      await waitFor(() => {
        expect(screen.getByText(/Math 101/)).not.toBeNull();
      });

      fireEvent.click(screen.getByRole('button', { name: /add assessment/i }));

      fireEvent.change(screen.getByLabelText(/assessment name \*/i), { target: { value: 'Exempt Quiz' } });
      fireEvent.change(screen.getByLabelText(/category \*/i), { target: { value: 'quiz' } });
      fireEvent.change(screen.getByLabelText(/max marks \*/i), { target: { value: '25' } });
      fireEvent.change(screen.getByLabelText(/^status$/i), { target: { value: 'exempt' } });
      fireEvent.change(screen.getByLabelText(/^marks$/i), { target: { value: '10' } });

      const form = screen.getByRole('button', { name: /create assessment/i }).closest('form')!;
      fireEvent.submit(form);

      await waitFor(() => {
        expect(screen.getByText(/exempt assessments must not contain marks/i)).not.toBeNull();
      });
    });

    test('validates 0.5 increments for max marks, weightage, and marks', async () => {
      render(<SubjectDetail />, { wrapper: Wrapper });
      await waitFor(() => {
        expect(screen.getByText(/Math 101/)).not.toBeNull();
      });

      fireEvent.click(screen.getByRole('button', { name: /add assessment/i }));

      fireEvent.change(screen.getByLabelText(/assessment name \*/i), { target: { value: 'Step Test' } });
      fireEvent.change(screen.getByLabelText(/category \*/i), { target: { value: 'quiz' } });
      fireEvent.change(screen.getByLabelText(/max marks \*/i), { target: { value: '25.2' } });
      fireEvent.change(screen.getByLabelText(/weightage \(%\)/i), { target: { value: '10.3' } });
      fireEvent.change(screen.getByLabelText(/^status$/i), { target: { value: 'scored' } });
      fireEvent.change(screen.getByLabelText(/^marks$/i), { target: { value: '20.1' } });

      const form = screen.getByRole('button', { name: /create assessment/i }).closest('form')!;
      fireEvent.submit(form);

      await waitFor(() => {
        expect(screen.getByText(/max marks must be in increments of 0.5/i)).not.toBeNull();
        expect(screen.getByText(/weightage must be in increments of 0.5/i)).not.toBeNull();
        expect(screen.getByText(/^marks must be in increments of 0.5/i)).not.toBeNull();
      });
    });

    test('input elements have correct step attributes', async () => {
      render(<SubjectDetail />, { wrapper: Wrapper });
      await waitFor(() => {
        expect(screen.getByText(/Math 101/)).not.toBeNull();
      });

      fireEvent.click(screen.getByRole('button', { name: /add assessment/i }));

      const maxMarksInput = screen.getByLabelText(/max marks \*/i) as HTMLInputElement;
      const weightageInput = screen.getByLabelText(/weightage \(%\)/i) as HTMLInputElement;
      const marksInput = screen.getByLabelText(/^marks$/i) as HTMLInputElement;

      expect(maxMarksInput.getAttribute('step')).toBe('0.5');
      expect(weightageInput.getAttribute('step')).toBe('0.5');
      expect(marksInput.getAttribute('step')).toBe('0.5');

      // Check edit subject credits step
      fireEvent.click(screen.getByRole('button', { name: /edit subject/i }));
      const creditsInput = screen.getByLabelText(/credits/i) as HTMLInputElement;
      expect(creditsInput.getAttribute('step')).toBe('1');
    });
  });

  describe('Stage 4.2.2B Phase 4: Gradebook Integration', () => {
    beforeEach(() => {
      vi.clearAllMocks();
      queryClient.clear();
      window.history.pushState({}, 'Test', '/app/semesters/1/subjects/2');
    });

    test('Test 1: is_auto_generated: true displays the Exam Linked badge', async () => {
      (api.get as any).mockImplementation((url: string) => {
        if (url === '/semesters/1') return Promise.resolve({ id: '1', name: 'Fall 2026' });
        if (url === '/subjects/2') return Promise.resolve({ id: '2', name: 'Math 101' });
        if (url === '/subjects/2/attendance') return Promise.resolve([]);
        if (url === '/subjects/2/assessments') return Promise.resolve([
          {
            id: '101',
            name: 'Auto Final Exam',
            category: 'endsem',
            max_marks: 100,
            marks: null,
            weightage: 40,
            status: 'pending',
            is_auto_generated: true,
            calendar_event_id: null,
          },
        ]);
        return Promise.resolve(null);
      });

      render(<SubjectDetail />, { wrapper: Wrapper });
      await waitFor(() => {
        expect(screen.getByText('Auto Final Exam')).not.toBeNull();
      });
      expect(screen.getByText('Exam Linked')).not.toBeNull();
    });

    test('Test 2: Non-null calendar_event_id displays the badge even if is_auto_generated is false', async () => {
      (api.get as any).mockImplementation((url: string) => {
        if (url === '/semesters/1') return Promise.resolve({ id: '1', name: 'Fall 2026' });
        if (url === '/subjects/2') return Promise.resolve({ id: '2', name: 'Math 101' });
        if (url === '/subjects/2/attendance') return Promise.resolve([]);
        if (url === '/subjects/2/assessments') return Promise.resolve([
          {
            id: '102',
            name: 'Midterm Linked',
            category: 'midsem',
            max_marks: 50,
            marks: null,
            weightage: 20,
            status: 'pending',
            is_auto_generated: false,
            calendar_event_id: 'cal-event-999',
          },
        ]);
        return Promise.resolve(null);
      });

      render(<SubjectDetail />, { wrapper: Wrapper });
      await waitFor(() => {
        expect(screen.getByText('Midterm Linked')).not.toBeNull();
      });
      expect(screen.getByText('Exam Linked')).not.toBeNull();
    });

    test('Test 3: Both fields present display exactly one badge', async () => {
      (api.get as any).mockImplementation((url: string) => {
        if (url === '/semesters/1') return Promise.resolve({ id: '1', name: 'Fall 2026' });
        if (url === '/subjects/2') return Promise.resolve({ id: '2', name: 'Math 101' });
        if (url === '/subjects/2/attendance') return Promise.resolve([]);
        if (url === '/subjects/2/assessments') return Promise.resolve([
          {
            id: '103',
            name: 'Dual Flag Exam',
            category: 'quiz',
            max_marks: 25,
            marks: null,
            weightage: 10,
            status: 'pending',
            is_auto_generated: true,
            calendar_event_id: 'cal-event-888',
          },
        ]);
        return Promise.resolve(null);
      });

      render(<SubjectDetail />, { wrapper: Wrapper });
      await waitFor(() => {
        expect(screen.getByText('Dual Flag Exam')).not.toBeNull();
      });
      const badges = screen.getAllByText('Exam Linked');
      expect(badges).toHaveLength(1);
    });

    test('Test 4: Manually created assessment with neither field displays no badge', async () => {
      (api.get as any).mockImplementation((url: string) => {
        if (url === '/semesters/1') return Promise.resolve({ id: '1', name: 'Fall 2026' });
        if (url === '/subjects/2') return Promise.resolve({ id: '2', name: 'Math 101' });
        if (url === '/subjects/2/attendance') return Promise.resolve([]);
        if (url === '/subjects/2/assessments') return Promise.resolve([
          {
            id: '104',
            name: 'Manual Quiz',
            category: 'quiz',
            max_marks: 20,
            marks: 18,
            weightage: 10,
            status: 'scored',
            is_auto_generated: false,
            calendar_event_id: null,
          },
        ]);
        return Promise.resolve(null);
      });

      render(<SubjectDetail />, { wrapper: Wrapper });
      await waitFor(() => {
        expect(screen.getByText('Manual Quiz')).not.toBeNull();
      });
      expect(screen.queryByText('Exam Linked')).toBeNull();
    });

    test('Test 5: UTC timestamp near midnight displays the intended UTC date, not local shifted date', async () => {
      const midnightUtc = '2026-10-15T00:30:00Z';
      const expectedUtcDate = new Date(midnightUtc).toLocaleDateString(undefined, { timeZone: 'UTC' });

      (api.get as any).mockImplementation((url: string) => {
        if (url === '/semesters/1') return Promise.resolve({ id: '1', name: 'Fall 2026' });
        if (url === '/subjects/2') return Promise.resolve({ id: '2', name: 'Math 101' });
        if (url === '/subjects/2/attendance') return Promise.resolve([]);
        if (url === '/subjects/2/assessments') return Promise.resolve([
          {
            id: '105',
            name: 'Midnight Exam',
            category: 'midsem',
            max_marks: 50,
            marks: null,
            weightage: 25,
            status: 'pending',
            scheduled_at: midnightUtc,
          },
        ]);
        return Promise.resolve(null);
      });

      render(<SubjectDetail />, { wrapper: Wrapper });
      await waitFor(() => {
        expect(screen.getByText('Midnight Exam')).not.toBeNull();
      });
      expect(screen.getByText((content) => content.includes(expectedUtcDate))).not.toBeNull();
    });

    test('Test 6: UTC noon anchor date display remains correct', async () => {
      const noonUtc = '2026-10-15T12:00:00Z';
      const expectedUtcDate = new Date(noonUtc).toLocaleDateString(undefined, { timeZone: 'UTC' });

      (api.get as any).mockImplementation((url: string) => {
        if (url === '/semesters/1') return Promise.resolve({ id: '1', name: 'Fall 2026' });
        if (url === '/subjects/2') return Promise.resolve({ id: '2', name: 'Math 101' });
        if (url === '/subjects/2/attendance') return Promise.resolve([]);
        if (url === '/subjects/2/assessments') return Promise.resolve([
          {
            id: '106',
            name: 'Noon Exam',
            category: 'endsem',
            max_marks: 100,
            marks: null,
            weightage: 50,
            status: 'pending',
            scheduled_at: noonUtc,
          },
        ]);
        return Promise.resolve(null);
      });

      render(<SubjectDetail />, { wrapper: Wrapper });
      await waitFor(() => {
        expect(screen.getByText('Noon Exam')).not.toBeNull();
      });
      expect(screen.getByText((content) => content.includes(expectedUtcDate))).not.toBeNull();
    });

    test('Test 7: Null or missing scheduled_at retains existing behavior', async () => {
      (api.get as any).mockImplementation((url: string) => {
        if (url === '/semesters/1') return Promise.resolve({ id: '1', name: 'Fall 2026' });
        if (url === '/subjects/2') return Promise.resolve({ id: '2', name: 'Math 101' });
        if (url === '/subjects/2/attendance') return Promise.resolve([]);
        if (url === '/subjects/2/assessments') return Promise.resolve([
          {
            id: '107',
            name: 'Unscheduled Assessment',
            category: 'assignment',
            max_marks: 30,
            marks: null,
            weightage: 15,
            status: 'pending',
            scheduled_at: null,
          },
        ]);
        return Promise.resolve(null);
      });

      render(<SubjectDetail />, { wrapper: Wrapper });
      await waitFor(() => {
        expect(screen.getByText('Unscheduled Assessment')).not.toBeNull();
      });
      expect(screen.getByText('Assignment • 15% weight')).not.toBeNull();
    });
  });
});
