import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { api } from '@/api/client';
import type { Semester } from '@/types/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';

const semesterSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  academic_year: z.string().min(1, 'Academic year is required'),
  start_date: z.string().optional(),
  end_date: z.string().optional(),
}).refine((data) => {
  if (data.start_date && data.end_date) {
    return data.start_date <= data.end_date;
  }
  return true;
}, {
  message: 'End date cannot be before start date',
  path: ['end_date'],
});

type SemesterForm = z.infer<typeof semesterSchema>;

export default function Semesters() {
  const queryClient = useQueryClient();
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState('');

  const [activatingId, setActivatingId] = useState<string | null>(null);

  const { data: semesters, isLoading } = useQuery<Semester[]>({
    queryKey: ['semesters'],
    queryFn: () => api.get('/semesters'),
  });

  const activateMutation = useMutation({
    mutationFn: (id: string) => api.patch(`/semesters/${id}/activate`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['semesters'] });
      queryClient.invalidateQueries({ queryKey: ['study-plans'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      queryClient.invalidateQueries({ queryKey: ['subjects'] });
      setActivatingId(null);
    },
    onError: (err: any) => {
      setError(err?.data?.detail || err.message || 'Failed to activate semester');
      setActivatingId(null);
    },
  });

  const createMutation = useMutation({
    mutationFn: (data: SemesterForm) => api.post('/semesters', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['semesters'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      setIsCreating(false);
      reset();
    },
    onError: (err: any) => {
      setError(err.message || 'Failed to create semester');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/semesters/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['semesters'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      queryClient.invalidateQueries({ queryKey: ['subjects'] });
    },
  });

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<SemesterForm>({
    resolver: zodResolver(semesterSchema),
  });

  const onSubmit = (data: SemesterForm) => {
    setError('');
    const payload: any = {
      name: data.name,
      academic_year: data.academic_year,
    };
    if (data.start_date && data.start_date.trim()) {
      payload.start_date = data.start_date;
    }
    if (data.end_date && data.end_date.trim()) {
      payload.end_date = data.end_date;
    }
    createMutation.mutate(payload);
  };

  const handleActivate = (id: string) => {
    setError('');
    setActivatingId(id);
    activateMutation.mutate(id);
  };

  const handleDelete = (id: string) => {
    setError('');
    if (window.confirm('Are you sure you want to delete this semester? This will delete all associated subjects and assessments.')) {
      deleteMutation.mutate(id);
    }
  };

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <p className="text-sm font-medium text-muted-foreground">Loading semesters...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Semesters</h1>
          <p className="text-sm text-muted-foreground mt-1">Manage your academic terms and active semester.</p>
        </div>
        <Button onClick={() => setIsCreating(!isCreating)}>
          {isCreating ? 'Cancel' : 'Add Semester'}
        </Button>
      </div>

      {error && (
        <div role="alert" className="p-3 bg-destructive/10 text-destructive border border-destructive/20 rounded-lg text-sm">
          {error}
        </div>
      )}

      {isCreating && (
        <div className="p-6 bg-card/85 backdrop-blur-md rounded-xl shadow-xs border border-border text-card-foreground">
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <h2 className="text-lg font-semibold text-foreground">Create New Semester</h2>

            <div className="space-y-2">
              <Label htmlFor="name" className="text-foreground">Semester Name</Label>
              <Input
                id="name"
                placeholder="e.g. Fall 2026"
                {...register('name')}
              />
              {errors.name && (
                <p className="text-sm text-destructive">{errors.name.message}</p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="academic_year" className="text-foreground">Academic Year</Label>
              <Input
                id="academic_year"
                placeholder="e.g. 2026-2027"
                {...register('academic_year')}
              />
              {errors.academic_year && (
                <p className="text-sm text-destructive">{errors.academic_year.message}</p>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="start_date" className="text-foreground">Start Date (Optional)</Label>
                <Input
                  id="start_date"
                  type="date"
                  {...register('start_date')}
                />
                {errors.start_date && (
                  <p className="text-sm text-destructive">{errors.start_date.message}</p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="end_date" className="text-foreground">End Date (Optional)</Label>
                <Input
                  id="end_date"
                  type="date"
                  {...register('end_date')}
                />
                {errors.end_date && (
                  <p className="text-sm text-destructive">{errors.end_date.message}</p>
                )}
              </div>
            </div>

            <Button
              type="submit"
              disabled={createMutation.isPending}
            >
              {createMutation.isPending ? 'Creating...' : 'Create Semester'}
            </Button>
          </form>
        </div>
      )}

      {!semesters?.length ? (
        <div className="text-center py-12 bg-card/85 backdrop-blur-md rounded-xl border border-dashed border-border text-card-foreground">
          <h3 className="text-sm font-medium text-foreground">No semesters</h3>
          <p className="mt-1 text-sm text-muted-foreground">Get started by creating a new semester.</p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {semesters.map((semester) => (
            <div
              key={semester.id}
              className={cn(
                "flex flex-col justify-between p-6 bg-card/85 backdrop-blur-md rounded-xl shadow-xs border transition-all duration-150",
                semester.is_active
                  ? "border-primary/50 ring-1 ring-primary/25 shadow-xs"
                  : "border-border hover:border-border/80"
              )}
            >
              <div>
                <div className="flex justify-between items-start mb-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="text-lg font-semibold text-foreground truncate">
                        <Link
                          to={`/app/semesters/${semester.id}`}
                          className="hover:text-primary transition-colors focus-visible:outline-none focus-visible:underline"
                        >
                          {semester.name}
                        </Link>
                      </h3>
                      {semester.is_active && (
                        <span className="inline-flex items-center rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 px-2.5 py-0.5 text-xs font-medium border border-emerald-500/20">
                          Active
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-muted-foreground mt-1">{semester.academic_year}</p>
                    {(semester.start_date || semester.end_date) && (
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {semester.start_date || 'Open'} &ndash; {semester.end_date || 'Open'}
                      </p>
                    )}
                  </div>
                </div>
              </div>
              <div className="mt-4 flex flex-wrap items-center gap-2 pt-3 border-t border-border/40">
                <Link to={`/app/semesters/${semester.id}`}>
                  <Button variant="secondary" size="sm">
                    View Subjects
                  </Button>
                </Link>
                {!semester.is_active && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleActivate(semester.id)}
                    disabled={activateMutation.isPending}
                  >
                    {activateMutation.isPending && activatingId === semester.id ? 'Activating...' : 'Activate'}
                  </Button>
                )}
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => handleDelete(semester.id)}
                  disabled={deleteMutation.isPending || (activateMutation.isPending && activatingId === semester.id)}
                >
                  Delete
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
