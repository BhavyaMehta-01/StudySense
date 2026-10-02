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

const semesterSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  academic_year: z.string().min(1, 'Academic year is required'),
});

type SemesterForm = z.infer<typeof semesterSchema>;

export default function Semesters() {
  const queryClient = useQueryClient();
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState('');

  const { data: semesters, isLoading } = useQuery<Semester[]>({
    queryKey: ['semesters'],
    queryFn: () => api.get('/semesters'),
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
    createMutation.mutate(data);
  };

  const handleDelete = (id: string) => {
    if (window.confirm('Are you sure you want to delete this semester? This will delete all associated subjects and assessments.')) {
      deleteMutation.mutate(id);
    }
  };

  if (isLoading) {
    return <div>Loading semesters...</div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Semesters</h1>
        <Button onClick={() => setIsCreating(!isCreating)}>
          {isCreating ? 'Cancel' : 'Add Semester'}
        </Button>
      </div>

      {error && (
        <div className="p-3 bg-red-50 text-red-700 rounded-md text-sm">
          {error}
        </div>
      )}

      {isCreating && (
        <div className="p-6 bg-white rounded-lg shadow-sm border border-gray-200">
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <h2 className="text-lg font-medium">Create New Semester</h2>
            
            <div className="space-y-2">
              <Label htmlFor="name">Semester Name</Label>
              <Input
                id="name"
                placeholder="e.g. Fall 2026"
                {...register('name')}
              />
              {errors.name && (
                <p className="text-sm text-red-600">{errors.name.message}</p>
              )}
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="academic_year">Academic Year</Label>
              <Input
                id="academic_year"
                placeholder="e.g. 2026-2027"
                {...register('academic_year')}
              />
              {errors.academic_year && (
                <p className="text-sm text-red-600">{errors.academic_year.message}</p>
              )}
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
        <div className="text-center py-12 bg-white rounded-lg border border-dashed border-gray-300">
          <h3 className="text-sm font-medium text-gray-900">No semesters</h3>
          <p className="mt-1 text-sm text-gray-500">Get started by creating a new semester.</p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {semesters.map((semester) => (
            <div
              key={semester.id}
              className="relative p-6 bg-white rounded-lg shadow-sm border border-gray-200 hover:border-gray-300 transition-colors"
            >
              <div className="flex justify-between items-start mb-4">
                <div>
                  <h3 className="text-lg font-semibold text-gray-900">
                    <Link to={`/app/semesters/${semester.id}`} className="focus:outline-none">
                      <span className="absolute inset-0" aria-hidden="true" />
                      {semester.name}
                    </Link>
                  </h3>
                  <p className="text-sm text-gray-500">{semester.academic_year}</p>
                </div>
              </div>
              <div className="mt-4 flex gap-2 relative z-10">
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => handleDelete(semester.id)}
                  disabled={deleteMutation.isPending}
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
