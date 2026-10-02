import { useState } from 'react';
import { useParams, Link } from 'react-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { api } from '@/api/client';
import type { Semester, Subject } from '@/types/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ArrowLeft } from 'lucide-react';

const subjectSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  code: z.string().optional(),
  credits: z.string().optional(),
});

type SubjectForm = z.infer<typeof subjectSchema>;

export default function SemesterDetail() {
  const { semesterId } = useParams<{ semesterId: string }>();
  const queryClient = useQueryClient();
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState('');

  const { data: semester, isLoading: isLoadingSemester } = useQuery<Semester>({
    queryKey: ['semesters', semesterId],
    queryFn: () => api.get(`/semesters/${semesterId}`),
  });

  const { data: subjects, isLoading: isLoadingSubjects } = useQuery<Subject[]>({
    queryKey: ['semesters', semesterId, 'subjects'],
    queryFn: () => api.get(`/semesters/${semesterId}/subjects`),
  });

  const createMutation = useMutation({
    mutationFn: (data: any) => api.post(`/semesters/${semesterId}/subjects`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['semesters', semesterId, 'subjects'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      setIsCreating(false);
      reset();
    },
    onError: (err: any) => {
      setError(err.message || 'Failed to create subject');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/subjects/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['semesters', semesterId, 'subjects'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      queryClient.invalidateQueries({ queryKey: ['subjects'] });
    },
  });

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<SubjectForm>({
    resolver: zodResolver(subjectSchema),
  });

  const onSubmit = (data: SubjectForm) => {
    setError('');
    // Remove undefined values to avoid sending them in JSON
    const payload = {
      name: data.name,
      ...(data.code && { code: data.code }),
      ...(data.credits && { credits: Number(data.credits) }),
    };
    createMutation.mutate(payload);
  };

  const handleDelete = (id: string) => {
    if (window.confirm('Are you sure you want to delete this subject?')) {
      deleteMutation.mutate(id);
    }
  };

  if (isLoadingSemester || isLoadingSubjects) {
    return <div>Loading...</div>;
  }

  if (!semester) {
    return <div>Semester not found</div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Link to="/app/semesters" className="text-gray-500 hover:text-gray-900">
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{semester.name}</h1>
          <p className="text-sm text-gray-500">Academic Year: {semester.academic_year}</p>
        </div>
      </div>

      <div className="flex items-center justify-between border-t border-gray-200 pt-6">
        <h2 className="text-xl font-semibold text-gray-900">Subjects</h2>
        <Button onClick={() => setIsCreating(!isCreating)}>
          {isCreating ? 'Cancel' : 'Add Subject'}
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
            <h3 className="text-lg font-medium">Create New Subject</h3>
            
            <div className="space-y-2">
              <Label htmlFor="name">Subject Name *</Label>
              <Input
                id="name"
                placeholder="e.g. Data Structures"
                {...register('name')}
              />
              {errors.name && (
                <p className="text-sm text-red-600">{errors.name.message}</p>
              )}
            </div>
            
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="code">Course Code</Label>
                <Input
                  id="code"
                  placeholder="e.g. CS201"
                  {...register('code')}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="credits">Credits</Label>
                <Input
                  id="credits"
                  type="number"
                  step="0.1"
                  placeholder="e.g. 3.0"
                  {...register('credits')}
                />
              </div>
            </div>

            <Button
              type="submit"
              disabled={createMutation.isPending}
            >
              {createMutation.isPending ? 'Creating...' : 'Create Subject'}
            </Button>
          </form>
        </div>
      )}

      {!subjects?.length ? (
        <div className="text-center py-12 bg-white rounded-lg border border-dashed border-gray-300">
          <h3 className="text-sm font-medium text-gray-900">No subjects</h3>
          <p className="mt-1 text-sm text-gray-500">Add a subject to this semester to get started.</p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {subjects.map((subject) => (
            <div
              key={subject.id}
              className="relative p-6 bg-white rounded-lg shadow-sm border border-gray-200"
            >
              <div className="mb-4">
                <h3 className="text-lg font-semibold text-gray-900">
                  <Link to={`/app/semesters/${semesterId}/subjects/${subject.id}`} className="focus:outline-none">
                    <span className="absolute inset-0" aria-hidden="true" />
                    {subject.name}
                  </Link>
                </h3>
                <div className="flex gap-4 mt-1">
                  {subject.code && (
                    <p className="text-sm text-gray-500">Code: {subject.code}</p>
                  )}
                  {subject.credits != null && (
                    <p className="text-sm text-gray-500">Credits: {subject.credits}</p>
                  )}
                </div>
              </div>
              <div className="mt-4 flex gap-2">
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => handleDelete(subject.id)}
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
