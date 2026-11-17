import { useState, useEffect } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { api } from '@/api/client';
import type { Semester } from '@/types/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

const semesterEditSchema = z.object({
  name: z.string().min(1, 'Semester name is required'),
  academic_year: z.string().min(1, 'Academic year is required'),
  start_date: z.string().optional(),
  end_date: z.string().optional(),
}).refine((data) => {
  if (data.start_date && data.end_date && data.start_date.trim() && data.end_date.trim()) {
    return data.start_date <= data.end_date;
  }
  return true;
}, {
  message: 'End date cannot be before start date',
  path: ['end_date'],
});

type SemesterEditForm = z.infer<typeof semesterEditSchema>;

interface EditSemesterModalProps {
  semester: Semester;
  isOpen: boolean;
  onClose: () => void;
}

export default function EditSemesterModal({ semester, isOpen, onClose }: EditSemesterModalProps) {
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<SemesterEditForm>({
    resolver: zodResolver(semesterEditSchema),
    defaultValues: {
      name: semester.name,
      academic_year: semester.academic_year,
      start_date: semester.start_date || '',
      end_date: semester.end_date || '',
    },
    values: {
      name: semester.name,
      academic_year: semester.academic_year,
      start_date: semester.start_date || '',
      end_date: semester.end_date || '',
    },
  });

  const updateMutation = useMutation({
    mutationFn: (data: SemesterEditForm) => {
      const payload: Record<string, any> = {
        name: data.name,
        academic_year: data.academic_year,
        start_date: data.start_date && data.start_date.trim() ? data.start_date : null,
        end_date: data.end_date && data.end_date.trim() ? data.end_date : null,
      };
      return api.put(`/semesters/${semester.id}`, payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['semesters', semester.id] });
      queryClient.invalidateQueries({ queryKey: ['semesters', semester.id, 'lectures'] });
      queryClient.invalidateQueries({ queryKey: ['semesters'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      setError(null);
      onClose();
    },
    onError: (err: any) => {
      setError(err?.data?.detail || err.message || 'Failed to update semester');
    },
  });

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const onSubmit = (data: SemesterEditForm) => {
    setError(null);
    updateMutation.mutate(data);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-background/80 backdrop-blur-xs"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="edit-semester-title"
        className="w-full max-w-lg p-6 bg-card text-card-foreground rounded-xl shadow-lg border border-border space-y-4"
      >
        <div className="flex items-center justify-between pb-2 border-b border-border">
          <h2 id="edit-semester-title" className="text-lg font-semibold text-foreground">
            Edit Semester
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground text-sm font-medium"
            aria-label="Close dialog"
          >
            &times;
          </button>
        </div>

        {error && (
          <div role="alert" className="p-3 bg-destructive/10 text-destructive border border-destructive/20 rounded-lg text-sm">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="edit-semester-name" className="text-foreground">Semester Name *</Label>
            <Input
              id="edit-semester-name"
              placeholder="e.g. Fall 2026"
              {...register('name')}
            />
            {errors.name && (
              <p className="text-xs text-destructive">{errors.name.message}</p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="edit-academic-year" className="text-foreground">Academic Year *</Label>
            <Input
              id="edit-academic-year"
              placeholder="e.g. 2026-2027"
              {...register('academic_year')}
            />
            {errors.academic_year && (
              <p className="text-xs text-destructive">{errors.academic_year.message}</p>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="edit-start-date" className="text-foreground">Start Date</Label>
              <Input
                id="edit-start-date"
                type="date"
                {...register('start_date')}
              />
              <p className="text-xs text-muted-foreground">Leave blank if open</p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="edit-end-date" className="text-foreground">End Date</Label>
              <Input
                id="edit-end-date"
                type="date"
                {...register('end_date')}
              />
              {errors.end_date && (
                <p className="text-xs text-destructive">{errors.end_date.message}</p>
              )}
              <p className="text-xs text-muted-foreground">Leave blank if open</p>
            </div>
          </div>

          <div className="flex justify-end gap-3 pt-3 border-t border-border">
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
              disabled={updateMutation.isPending}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={updateMutation.isPending}
            >
              {updateMutation.isPending ? 'Saving...' : 'Save Changes'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
