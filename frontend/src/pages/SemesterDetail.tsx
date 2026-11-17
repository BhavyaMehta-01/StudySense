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
import { ArrowLeft, Edit2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import EditSemesterModal from '@/components/timetable/EditSemesterModal';
import TimetableSlotManager from '@/components/timetable/TimetableSlotManager';
import CalendarEventManager from '@/components/timetable/CalendarEventManager';

const subjectSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  code: z.string().optional(),
  credits: z.string().optional().refine((val) => {
    if (!val || val.trim() === '') return true;
    const num = Number(val);
    return !isNaN(num) && Number.isInteger(num) && num >= 0;
  }, { message: 'Credits must be a non-negative whole number' }),
});

type SubjectForm = z.infer<typeof subjectSchema>;

export default function SemesterDetail() {
  const { semesterId } = useParams<{ semesterId: string }>();
  const queryClient = useQueryClient();
  const [isCreating, setIsCreating] = useState(false);
  const [isEditingSemester, setIsEditingSemester] = useState(false);
  const [activeTab, setActiveTab] = useState<'subjects' | 'timetable' | 'calendar'>('subjects');
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
    return (
      <div className="flex h-64 items-center justify-center">
        <p className="text-sm font-medium text-muted-foreground">Loading...</p>
      </div>
    );
  }

  if (!semester) {
    return (
      <div className="rounded-xl border border-border bg-card/85 backdrop-blur-md p-12 text-center text-card-foreground shadow-xs">
        <h3 className="text-lg font-semibold text-foreground">Semester not found</h3>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-center gap-4">
          <Link to="/app/semesters" className="text-muted-foreground hover:text-foreground transition-colors">
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-foreground">{semester.name}</h1>
            <p className="text-sm text-muted-foreground">
              Academic Year: {semester.academic_year}
              {(semester.start_date || semester.end_date) && (
                <span> &bull; Dates: {semester.start_date || 'Open'} &ndash; {semester.end_date || 'Open'}</span>
              )}
            </p>
          </div>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setIsEditingSemester(true)}
          className="self-start sm:self-auto flex items-center gap-2"
        >
          <Edit2 className="h-4 w-4" />
          Edit Semester
        </Button>
      </div>

      <EditSemesterModal
        semester={semester}
        isOpen={isEditingSemester}
        onClose={() => setIsEditingSemester(false)}
      />

      {/* Navigation Tabs */}
      <div className="flex border-b border-border space-x-6">
        <button
          type="button"
          onClick={() => setActiveTab('subjects')}
          className={cn(
            'pb-3 text-sm font-medium border-b-2 transition-colors -mb-px',
            activeTab === 'subjects'
              ? 'border-primary text-primary font-semibold'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          )}
        >
          Subjects {subjects ? `(${subjects.length})` : ''}
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('timetable')}
          className={cn(
            'pb-3 text-sm font-medium border-b-2 transition-colors -mb-px',
            activeTab === 'timetable'
              ? 'border-primary text-primary font-semibold'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          )}
        >
          Weekly Timetable
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('calendar')}
          className={cn(
            'pb-3 text-sm font-medium border-b-2 transition-colors -mb-px',
            activeTab === 'calendar'
              ? 'border-primary text-primary font-semibold'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          )}
        >
          Academic Calendar
        </button>
      </div>

      {activeTab === 'subjects' && (
        <div className="space-y-6">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-semibold tracking-tight text-foreground">Subjects</h2>
            <Button onClick={() => setIsCreating(!isCreating)}>
              {isCreating ? 'Cancel' : 'Add Subject'}
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
                <h3 className="text-lg font-semibold text-foreground">Create New Subject</h3>

                <div className="space-y-2">
                  <Label htmlFor="name" className="text-foreground">Subject Name *</Label>
                  <Input
                    id="name"
                    placeholder="e.g. Data Structures"
                    {...register('name')}
                  />
                  {errors.name && (
                    <p className="text-sm text-destructive">{errors.name.message}</p>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="code" className="text-foreground">Course Code</Label>
                    <Input
                      id="code"
                      placeholder="e.g. CS201"
                      {...register('code')}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="credits" className="text-foreground">Credits</Label>
                    <Input
                      id="credits"
                      type="number"
                      step="1"
                      placeholder="e.g. 3"
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
            <div className="text-center py-12 bg-card/85 backdrop-blur-md rounded-xl border border-dashed border-border text-card-foreground">
              <h3 className="text-sm font-medium text-foreground">No subjects</h3>
              <p className="mt-1 text-sm text-muted-foreground">Add a subject to this semester to get started.</p>
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {subjects.map((subject) => (
                <div
                  key={subject.id}
                  className="relative p-6 bg-card/85 backdrop-blur-md rounded-xl shadow-xs border border-border text-card-foreground transition-all duration-150 hover:border-border/80"
                >
                  <div className="mb-4">
                    <h3 className="text-lg font-semibold text-foreground">
                      <Link to={`/app/semesters/${semesterId}/subjects/${subject.id}`} className="focus:outline-none hover:text-primary transition-colors">
                        <span className="absolute inset-0" aria-hidden="true" />
                        {subject.name}
                      </Link>
                    </h3>
                    <div className="flex gap-4 mt-1">
                      {subject.code && (
                        <p className="text-sm text-muted-foreground">Code: {subject.code}</p>
                      )}
                      {subject.credits != null && (
                        <p className="text-sm text-muted-foreground">Credits: {subject.credits}</p>
                      )}
                    </div>
                  </div>
                  <div className="mt-4 flex gap-2 relative z-10">
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
      )}

      {activeTab === 'timetable' && (
        <TimetableSlotManager
          semesterId={semesterId!}
          semesterStartDate={semester.start_date}
          semesterEndDate={semester.end_date}
          subjects={subjects || []}
        />
      )}

      {activeTab === 'calendar' && (
        <CalendarEventManager
          semesterId={semesterId!}
          semesterStartDate={semester.start_date}
          semesterEndDate={semester.end_date}
          subjects={subjects || []}
        />
      )}
    </div>
  );
}
