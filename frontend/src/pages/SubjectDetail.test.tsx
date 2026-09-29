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

describe('SubjectDetail - Assessments', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queryClient.clear();
    window.history.pushState({}, 'Test', '/app/semesters/1/subjects/2');
    
    (api.get as any).mockImplementation((url: string) => {
      if (url === '/semesters/1') return Promise.resolve({ id: '1', name: 'Fall 2026' });
      if (url === '/subjects/2') return Promise.resolve({ id: '2', name: 'Math 101', code: 'M101' });
      if (url === '/subjects/2/assessments') return Promise.resolve([]);
      return Promise.resolve(null);
    });
  });

  test('renders subject details and empty assessments state', async () => {
    render(<SubjectDetail />, { wrapper: Wrapper });
    
    await waitFor(() => {
      expect(screen.getByText('Math 101 (M101)')).not.toBeNull();
      expect(screen.getByText('Fall 2026 • Assessments')).not.toBeNull();
      expect(screen.getByText('No assessments')).not.toBeNull();
    });
  });

  test('renders assessment list', async () => {
    (api.get as any).mockImplementation((url: string) => {
      if (url === '/subjects/2/assessments') return Promise.resolve([
        { id: '10', name: 'Midterm', category: 'Exam', max_marks: 100, marks: 85, weightage: 30, status: 'scored' },
        { id: '11', name: 'Final', category: 'Exam', max_marks: 100, marks: null, weightage: 40, status: 'pending' },
        { id: '12', name: 'Quiz 1', category: 'Quiz', max_marks: 10, marks: 0, weightage: 5, status: 'scored' }
      ]);
      return Promise.resolve({ id: '2', name: 'Math 101' });
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
      if (url === '/subjects/2/assessments') return Promise.resolve([
        { id: '10', name: 'Midterm', category: 'Exam', max_marks: 100, marks: null, weightage: 30, status: 'pending' }
      ]);
      return Promise.resolve({ id: '2', name: 'Math' });
    });
    
    (api.put as any).mockResolvedValueOnce({ id: '10' });
    
    render(<SubjectDetail />, { wrapper: Wrapper });
    
    await waitFor(() => expect(screen.getByText('Midterm')).not.toBeNull());
    
    // Click edit button
    const editButtons = screen.getAllByRole('button').filter(b => b.innerHTML.includes('lucide-edit2') || b.querySelector('svg'));
    // Assuming edit is the first icon button
    fireEvent.click(editButtons[0]);
    
    await waitFor(() => expect(screen.getByDisplayValue('Midterm')).not.toBeNull());
    
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
});
