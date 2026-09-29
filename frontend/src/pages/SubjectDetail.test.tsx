import { render, screen, fireEvent, waitFor } from '@testing-library/react';
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
      expect(screen.getByText(/must be integer >= 0/i)).not.toBeNull();
    });

    fireEvent.change(screen.getByLabelText(/attended \*/i), { target: { value: '6' } });
    fireEvent.change(screen.getByLabelText(/held \*/i), { target: { value: '5' } });
    fireEvent.click(screen.getAllByRole('button', { name: /record attendance/i })[1]);
    
    await waitFor(() => {
      expect(screen.getByText(/attended cannot exceed held/i)).not.toBeNull();
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
        { id: '10', name: 'Midterm', category: 'Exam', max_marks: 100, marks: 85, weightage: 30, status: 'scored' },
        { id: '11', name: 'Final', category: 'Exam', max_marks: 100, marks: null, weightage: 40, status: 'pending' },
        { id: '12', name: 'Quiz 1', category: 'Quiz', max_marks: 10, marks: 0, weightage: 5, status: 'scored' }
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
    fireEvent.change(screen.getByLabelText(/category \*/i), { target: { value: 'Homework' } });
    fireEvent.change(screen.getByLabelText(/max marks \*/i), { target: { value: '50' } });
    fireEvent.change(screen.getByLabelText(/^status/i), { target: { value: 'pending' } });
    // Empty marks should send null
    
    fireEvent.click(screen.getByRole('button', { name: /create assessment/i }));
    
    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith('/subjects/2/assessments', {
        name: 'Assignment 1',
        category: 'Homework',
        max_marks: 50,
        status: 'pending',
        marks: null,
        weightage: null,
        scheduled_at: null,
      });
    });
  });
  
  test('updates assessment successfully', async () => {
    (api.get as any).mockImplementation((url: string) => {
      if (url === '/semesters/1') return Promise.resolve({ id: '1', name: 'Fall 2026' });
      if (url === '/subjects/2') return Promise.resolve({ id: '2', name: 'Math' });
      if (url === '/subjects/2/attendance') return Promise.resolve([]);
      if (url === '/subjects/2/assessments') return Promise.resolve([
        { id: '10', name: 'Midterm', category: 'Exam', max_marks: 100, marks: null, weightage: 30, status: 'pending' }
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
        category: 'Exam',
        max_marks: 100,
        status: 'scored',
        marks: 95,
        weightage: 30,
        scheduled_at: null,
      });
    });
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
});
