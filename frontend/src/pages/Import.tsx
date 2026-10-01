import { useState, useRef } from 'react';
import { useNavigate } from 'react-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/client';
import type { ImportResponse } from '@/types/api';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';

export default function Import() {
  const [importType, setImportType] = useState<'academic' | 'attendance'>('academic');
  const [file, setFile] = useState<File | null>(null);
  const [previewResult, setPreviewResult] = useState<ImportResponse | null>(null);
  const [apiError, setApiError] = useState<string | null>(null);
  
  const fileInputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const handleTypeChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setImportType(e.target.value as 'academic' | 'attendance');
    setPreviewResult(null);
    setApiError(null);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0];
    if (selected) {
      setFile(selected);
      setPreviewResult(null);
      setApiError(null);
    }
  };

  const previewMutation = useMutation({
    mutationFn: async () => {
      if (!file) throw new Error('No file selected');
      const formData = new FormData();
      formData.append('file', file);
      formData.append('import_type', importType);
      formData.append('dry_run', 'true'); // backend expects bool form field, we send string 'true'
      
      return api.post('/import/csv', formData) as Promise<ImportResponse>;
    },
    onSuccess: (data) => {
      setPreviewResult(data);
      setApiError(null);
    },
    onError: (err: any) => {
      setApiError(err?.data?.detail || err.message || 'An error occurred during preview');
      setPreviewResult(null);
    },
  });

  const confirmMutation = useMutation({
    mutationFn: async () => {
      if (!file) throw new Error('No file selected');
      const formData = new FormData();
      formData.append('file', file);
      formData.append('import_type', importType);
      formData.append('dry_run', 'false');
      
      return api.post('/import/csv', formData) as Promise<ImportResponse>;
    },
    onSuccess: async (data) => {
      if (!data.success) {
        setApiError(data.errors?.[0]?.message || 'Import failed due to validation or server errors.');
        return;
      }
      
      await queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      await queryClient.invalidateQueries({ queryKey: ['semesters'] });
      await queryClient.invalidateQueries({ queryKey: ['subjects'] });
      
      // Navigate on success
      navigate('/app/dashboard');
    },
    onError: (err: any) => {
      setApiError(err?.data?.detail || err.message || 'An error occurred during import');
    },
  });

  const isPreviewing = previewMutation.isPending;
  const isConfirming = confirmMutation.isPending;
  const isLoading = isPreviewing || isConfirming;

  const hasPreviewSuccess = previewResult !== null && previewResult.success === true && previewResult.errors.length === 0;
  const hasPreviewErrors = previewResult !== null && previewResult.success === false && previewResult.errors.length > 0;

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h2 className="text-2xl font-bold text-gray-900">Import CSV</h2>
        <p className="mt-1 text-sm text-gray-500">
          Upload a CSV file to bulk import your academic data or attendance records.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="space-y-6 rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
          <div className="space-y-4">
            <div>
              <Label htmlFor="import_type">Import Type</Label>
              <select
                id="import_type"
                value={importType}
                onChange={handleTypeChange}
                disabled={isLoading}
                className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              >
                <option value="academic">Academic (Assessments, Marks)</option>
                <option value="attendance">Attendance</option>
              </select>
            </div>

            <div>
              <Label htmlFor="csv_file">CSV File</Label>
              <input
                id="csv_file"
                type="file"
                accept=".csv"
                ref={fileInputRef}
                onChange={handleFileChange}
                disabled={isLoading}
                className="mt-1 block w-full text-sm text-gray-500 file:mr-4 file:rounded-md file:border-0 file:bg-blue-50 file:px-4 file:py-2 file:text-sm file:font-semibold file:text-blue-700 hover:file:bg-blue-100"
              />
              {file && (
                <p className="mt-2 text-sm text-gray-600">
                  Selected file: <span className="font-medium">{file.name}</span>
                </p>
              )}
            </div>

            <div className="pt-2">
              <Button 
                onClick={() => previewMutation.mutate()} 
                disabled={!file || isLoading}
                className="w-full"
              >
                {isPreviewing ? 'Previewing...' : 'Preview Import'}
              </Button>
            </div>
          </div>
        </div>

        <div className="rounded-lg border border-gray-200 bg-gray-50 p-6">
          <h3 className="text-sm font-medium text-gray-900 mb-2">Expected CSV Columns</h3>
          {importType === 'academic' ? (
            <code className="block text-xs text-gray-600 bg-white p-3 rounded border border-gray-200 overflow-x-auto whitespace-nowrap">
              semester, subject, assessment, category, status, max_marks, marks, weightage, scheduled_date
            </code>
          ) : (
            <code className="block text-xs text-gray-600 bg-white p-3 rounded border border-gray-200 overflow-x-auto whitespace-nowrap">
              semester, subject, classes_attended, classes_held, recorded_on
            </code>
          )}
        </div>
      </div>

      {apiError && (
        <div className="rounded-lg bg-red-50 p-4 border border-red-200">
          <h3 className="text-sm font-medium text-red-800">API Error</h3>
          <p className="mt-1 text-sm text-red-700">{apiError}</p>
        </div>
      )}

      {hasPreviewSuccess && (
        <div className="rounded-lg border border-green-200 bg-green-50 p-6 shadow-sm">
          <h3 className="text-lg font-medium text-green-900">Preview Successful</h3>
          <p className="mt-1 text-sm text-green-700 mb-4">
            No errors found. Found {previewResult.total_processed} rows. {previewResult.imported_records} records will be imported.
            <br />
            <strong>No data has been committed yet.</strong>
          </p>
          
          <Button 
            onClick={() => confirmMutation.mutate()} 
            disabled={isLoading}
            className="bg-green-600 hover:bg-green-700 text-white"
          >
            {isConfirming ? 'Importing...' : 'Confirm Import'}
          </Button>
        </div>
      )}

      {hasPreviewErrors && (
        <div className="rounded-lg border border-red-200 bg-white shadow-sm overflow-hidden">
          <div className="bg-red-50 px-6 py-4 border-b border-red-200">
            <h3 className="text-lg font-medium text-red-900">Validation Errors</h3>
            <p className="mt-1 text-sm text-red-700">
              Found {previewResult.errors.length} error(s). Nothing was imported.
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm text-gray-600">
              <thead className="bg-gray-50 text-gray-900 text-xs uppercase">
                <tr>
                  <th className="px-6 py-3 font-medium">Row</th>
                  <th className="px-6 py-3 font-medium">Column</th>
                  <th className="px-6 py-3 font-medium">Message</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {previewResult.errors.map((error, idx) => (
                  <tr key={idx}>
                    <td className="px-6 py-4">{error.row}</td>
                    <td className="px-6 py-4 font-mono text-xs">{error.column || '-'}</td>
                    <td className="px-6 py-4 text-red-600">{error.message}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
