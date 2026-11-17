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
        <h2 className="text-2xl font-bold tracking-tight text-foreground">Import CSV</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Upload a CSV file to bulk import your academic data or attendance records.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="space-y-6 rounded-xl border border-border bg-card/85 backdrop-blur-md p-6 shadow-xs text-card-foreground">
          <div className="space-y-4">
            <div>
              <Label htmlFor="import_type" className="text-foreground">Import Type</Label>
              <select
                id="import_type"
                value={importType}
                onChange={handleTypeChange}
                disabled={isLoading}
                className="mt-1.5 block w-full rounded-md border border-input bg-card text-foreground px-3 py-2 text-sm shadow-xs focus:outline-none focus:ring-1 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
              >
                <option value="academic" className="bg-card text-foreground">Academic (Assessments, Marks)</option>
                <option value="attendance" className="bg-card text-foreground">Attendance</option>
              </select>
            </div>

            <div>
              <Label htmlFor="csv_file" className="text-foreground">CSV File</Label>
              <input
                id="csv_file"
                type="file"
                accept=".csv"
                ref={fileInputRef}
                onChange={handleFileChange}
                disabled={isLoading}
                className="mt-1.5 block w-full text-sm text-muted-foreground file:mr-4 file:rounded-md file:border-0 file:bg-primary/10 file:px-4 file:py-2 file:text-sm file:font-semibold file:text-primary hover:file:bg-primary/20 file:transition-colors file:cursor-pointer disabled:cursor-not-allowed disabled:opacity-50"
              />
              {file && (
                <p className="mt-2 text-sm text-muted-foreground">
                  Selected file: <span className="font-medium text-foreground">{file.name}</span>
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

        <div className="rounded-xl border border-border bg-card/60 backdrop-blur-md p-6 text-card-foreground">
          <h3 className="text-sm font-semibold text-foreground mb-2">Expected CSV Columns</h3>
          {importType === 'academic' ? (
            <code className="block text-xs text-muted-foreground bg-muted/60 p-3 rounded-lg border border-border/60 overflow-x-auto whitespace-nowrap font-mono">
              semester, subject, assessment, category, status, max_marks, marks, weightage, scheduled_date
            </code>
          ) : (
            <code className="block text-xs text-muted-foreground bg-muted/60 p-3 rounded-lg border border-border/60 overflow-x-auto whitespace-nowrap font-mono">
              semester, subject, classes_attended, classes_held, recorded_on
            </code>
          )}
        </div>
      </div>

      {apiError && (
        <div role="alert" className="rounded-xl bg-destructive/10 p-4 border border-destructive/20 text-destructive">
          <h3 className="text-sm font-semibold">API Error</h3>
          <p className="mt-1 text-sm opacity-90">{apiError}</p>
        </div>
      )}

      {hasPreviewSuccess && (
        <div className="rounded-xl border border-success/30 bg-success/10 p-6 shadow-xs">
          <h3 className="text-lg font-semibold text-foreground">Preview Successful</h3>
          <p className="mt-1 text-sm text-muted-foreground mb-4">
            No errors found. Found {previewResult.total_processed} rows. {previewResult.imported_records} records will be imported.
            <br />
            <strong className="text-foreground">No data has been committed yet.</strong>
          </p>
          
          <Button 
            onClick={() => confirmMutation.mutate()} 
            disabled={isLoading}
            className="bg-success text-success-foreground hover:bg-success/90"
          >
            {isConfirming ? 'Importing...' : 'Confirm Import'}
          </Button>
        </div>
      )}

      {hasPreviewErrors && (
        <div className="rounded-xl border border-destructive/30 bg-card/85 backdrop-blur-md shadow-xs overflow-hidden text-card-foreground">
          <div className="bg-destructive/10 px-6 py-4 border-b border-destructive/20">
            <h3 className="text-lg font-semibold text-destructive">Validation Errors</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Found <span className="font-semibold text-destructive tabular-nums">{previewResult.errors.length}</span> error(s). Nothing was imported.
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm text-foreground">
              <thead className="bg-muted/50 text-muted-foreground text-xs uppercase border-b border-border">
                <tr>
                  <th className="px-6 py-3 font-semibold">Row</th>
                  <th className="px-6 py-3 font-semibold">Column</th>
                  <th className="px-6 py-3 font-semibold">Message</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {previewResult.errors.map((error, idx) => (
                  <tr key={idx} className="hover:bg-muted/40 transition-colors">
                    <td className="px-6 py-4 tabular-nums font-medium">{error.row}</td>
                    <td className="px-6 py-4 font-mono text-xs text-muted-foreground">{error.column || '-'}</td>
                    <td className="px-6 py-4 text-destructive font-medium">{error.message}</td>
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
