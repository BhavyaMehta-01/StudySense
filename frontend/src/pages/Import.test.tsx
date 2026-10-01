import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, test, expect, vi, beforeEach } from 'vitest';
import { BrowserRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import Import from './Import';
import { api } from '@/api/client';

vi.mock('@/api/client', () => ({
  api: {
    post: vi.fn(),
  }
}));

const mockNavigate = vi.fn();
vi.mock('react-router', async () => {
  const actual = await vi.importActual('react-router');
  return {
    ...actual as any,
    useNavigate: () => mockNavigate,
  };
});

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false } },
});

const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <QueryClientProvider client={queryClient}>
    <BrowserRouter>{children}</BrowserRouter>
  </QueryClientProvider>
);

describe('Import CSV', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queryClient.clear();
  });

  const selectFile = (fileInput: HTMLElement, filename: string = 'test.csv') => {
    const file = new File(['test,csv'], filename, { type: 'text/csv' });
    fireEvent.change(fileInput, { target: { files: [file] } });
    return file;
  };

  test('renders initial page and expected columns', () => {
    render(<Import />, { wrapper: Wrapper });
    expect(screen.getByText('Import CSV')).not.toBeNull();
    expect(screen.getByLabelText(/Import Type/i)).not.toBeNull();
    expect(screen.getByLabelText(/CSV File/i)).not.toBeNull();
    // Default is academic
    expect(screen.getByText(/semester, subject, assessment, category, status, max_marks, marks, weightage, scheduled_date/i)).not.toBeNull();
  });

  test('changes import type and updates columns', () => {
    render(<Import />, { wrapper: Wrapper });
    const select = screen.getByLabelText(/Import Type/i);
    fireEvent.change(select, { target: { value: 'attendance' } });
    
    expect(screen.getByText(/semester, subject, classes_attended, classes_held, recorded_on/i)).not.toBeNull();
  });

  test('displays selected filename', () => {
    render(<Import />, { wrapper: Wrapper });
    const fileInput = screen.getByLabelText(/CSV File/i);
    selectFile(fileInput, 'my_data.csv');
    
    expect(screen.getByText(/my_data.csv/i)).not.toBeNull();
  });

  test('preview submits correct FormData', async () => {
    (api.post as any).mockResolvedValue({ success: true, total_processed: 1, imported_records: 1, errors: [] });
    
    render(<Import />, { wrapper: Wrapper });
    const fileInput = screen.getByLabelText(/CSV File/i);
    selectFile(fileInput);
    
    fireEvent.click(screen.getByRole('button', { name: /Preview Import/i }));
    
    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith('/import/csv', expect.any(FormData));
    });
    
    const formData = (api.post as any).mock.calls[0][1] as FormData;
    expect(formData.get('import_type')).toBe('academic');
    expect(formData.get('dry_run')).toBe('true');
    expect(formData.get('file')).toBeInstanceOf(File);
  });

  test('successful preview shows confirmation button', async () => {
    (api.post as any).mockResolvedValue({ success: true, total_processed: 5, imported_records: 5, errors: [] });
    
    render(<Import />, { wrapper: Wrapper });
    const fileInput = screen.getByLabelText(/CSV File/i);
    selectFile(fileInput);
    
    fireEvent.click(screen.getByRole('button', { name: /Preview Import/i }));
    
    await waitFor(() => {
      expect(screen.getByText(/Preview Successful/i)).not.toBeNull();
      expect(screen.getByText(/Found 5 rows. 5 records will be imported/i)).not.toBeNull();
      expect(screen.getByRole('button', { name: /Confirm Import/i })).not.toBeNull();
    });
  });

  test('validation errors display correctly', async () => {
    (api.post as any).mockResolvedValue({ 
      success: false, 
      total_processed: 1, 
      imported_records: 0, 
      errors: [{ row: 2, column: 'weightage', message: 'Invalid weightage' }] 
    });
    
    render(<Import />, { wrapper: Wrapper });
    const fileInput = screen.getByLabelText(/CSV File/i);
    selectFile(fileInput);
    
    fireEvent.click(screen.getByRole('button', { name: /Preview Import/i }));
    
    await waitFor(() => {
      expect(screen.getByText(/Validation Errors/i)).not.toBeNull();
      expect(screen.getByText(/Invalid weightage/i)).not.toBeNull();
      expect(screen.queryByRole('button', { name: /Confirm Import/i })).toBeNull();
    });
  });

  test('changing file invalidates preview', async () => {
    (api.post as any).mockResolvedValue({ success: true, total_processed: 1, imported_records: 1, errors: [] });
    
    render(<Import />, { wrapper: Wrapper });
    const fileInput = screen.getByLabelText(/CSV File/i);
    selectFile(fileInput, 'first.csv');
    
    fireEvent.click(screen.getByRole('button', { name: /Preview Import/i }));
    
    await waitFor(() => {
      expect(screen.getByText(/Preview Successful/i)).not.toBeNull();
    });
    
    selectFile(fileInput, 'second.csv');
    
    expect(screen.queryByText(/Preview Successful/i)).toBeNull();
  });

  test('changing import type invalidates preview', async () => {
    (api.post as any).mockResolvedValue({ success: true, total_processed: 1, imported_records: 1, errors: [] });
    
    render(<Import />, { wrapper: Wrapper });
    const fileInput = screen.getByLabelText(/CSV File/i);
    selectFile(fileInput);
    
    fireEvent.click(screen.getByRole('button', { name: /Preview Import/i }));
    
    await waitFor(() => {
      expect(screen.getByText(/Preview Successful/i)).not.toBeNull();
    });
    
    const select = screen.getByLabelText(/Import Type/i);
    fireEvent.change(select, { target: { value: 'attendance' } });
    
    expect(screen.queryByText(/Preview Successful/i)).toBeNull();
  });

  test('confirmation submits dry_run=false and navigates', async () => {
    (api.post as any).mockResolvedValueOnce({ success: true, total_processed: 1, imported_records: 1, errors: [] })
                     .mockResolvedValueOnce({ success: true, total_processed: 1, imported_records: 1, errors: [] });
    
    render(<Import />, { wrapper: Wrapper });
    const fileInput = screen.getByLabelText(/CSV File/i);
    selectFile(fileInput);
    
    fireEvent.click(screen.getByRole('button', { name: /Preview Import/i }));
    
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Confirm Import/i })).not.toBeNull();
    });
    
    fireEvent.click(screen.getByRole('button', { name: /Confirm Import/i }));
    
    await waitFor(() => {
      expect(api.post).toHaveBeenCalledTimes(2);
      const confirmData = (api.post as any).mock.calls[1][1] as FormData;
      expect(confirmData.get('dry_run')).toBe('false');
      expect(mockNavigate).toHaveBeenCalledWith('/app/dashboard');
    });
  });

  test('confirmation fails despite HTTP 200 (success: false)', async () => {
    (api.post as any).mockResolvedValueOnce({ success: true, total_processed: 1, imported_records: 1, errors: [] })
                     .mockResolvedValueOnce({ 
                       success: false, 
                       total_processed: 1, 
                       imported_records: 0, 
                       errors: [{ row: 2, column: "marks", message: "Import failed due to validation or server errors." }] 
                     });
    
    render(<Import />, { wrapper: Wrapper });
    const fileInput = screen.getByLabelText(/CSV File/i);
    selectFile(fileInput);
    
    // 1. Preview
    fireEvent.click(screen.getByRole('button', { name: /Preview Import/i }));
    
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Confirm Import/i })).not.toBeNull();
    });
    
    // 2. Confirm
    fireEvent.click(screen.getByRole('button', { name: /Confirm Import/i }));
    
    await waitFor(() => {
      // 3. Assert error displayed and navigation/invalidation didn't happen
      expect(screen.getByText(/Import failed due to validation or server errors./i)).not.toBeNull();
      expect(mockNavigate).not.toHaveBeenCalled();
    });
  });

  test('api failure is displayed', async () => {
    (api.post as any).mockRejectedValue(new Error('Network Error'));
    
    render(<Import />, { wrapper: Wrapper });
    const fileInput = screen.getByLabelText(/CSV File/i);
    selectFile(fileInput);
    
    fireEvent.click(screen.getByRole('button', { name: /Preview Import/i }));
    
    await waitFor(() => {
      expect(screen.getByText(/API Error/i)).not.toBeNull();
      expect(screen.getByText(/Network Error/i)).not.toBeNull();
    });
  });
});
