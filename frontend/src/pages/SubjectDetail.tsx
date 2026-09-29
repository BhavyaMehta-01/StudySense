import { useState } from 'react';
import { useParams, Link } from 'react-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { api } from '@/api/client';
import type { Semester, Subject, Assessment } from '@/types/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ArrowLeft, Edit2, Trash2 } from 'lucide-react';

const assessmentSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  category: z.string().min(1, 'Category is required'),
  max_marks: z.string().min(1, 'Max marks is required'),
  marks: z.string().optional(),
  weightage: z.string().optional(),
  scheduled_at: z.string().optional(),
  status: z.enum(['pending', 'scored', 'absent', 'exempt']),
}).superRefine((data, ctx) => {
  const maxMarks = Number(data.max_marks);
  if (isNaN(maxMarks) || maxMarks <= 0) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Max marks must be > 0', path: ['max_marks'] });
  }
  
  if (data.marks) {
    const marks = Number(data.marks);
    if (isNaN(marks) || marks < 0 || marks > maxMarks) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Marks must be between 0 and ${maxMarks}`, path: ['marks'] });
    }
  }

  if (data.weightage) {
    const weightage = Number(data.weightage);
    if (isNaN(weightage) || weightage <= 0 || weightage > 100) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Weightage must be between 0 and 100', path: ['weightage'] });
    }
  }
});

type AssessmentForm = z.infer<typeof assessmentSchema>;

export default function SubjectDetail() {
  const { semesterId, subjectId } = useParams<{ semesterId: string, subjectId: string }>();
  const queryClient = useQueryClient();
  const [isCreating, setIsCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [error, setError] = useState('');

  const { data: semester } = useQuery<Semester>({
    queryKey: ['semesters', semesterId],
    queryFn: () => api.get(`/semesters/${semesterId}`),
  });

  const { data: subject, isLoading: isLoadingSubject } = useQuery<Subject>({
    queryKey: ['subjects', subjectId],
    queryFn: () => api.get(`/subjects/${subjectId}`),
  });

  const { data: assessments, isLoading: isLoadingAssessments } = useQuery<Assessment[]>({
    queryKey: ['subjects', subjectId, 'assessments'],
    queryFn: () => api.get(`/subjects/${subjectId}/assessments`),
  });

  const invalidateData = () => {
    queryClient.invalidateQueries({ queryKey: ['subjects', subjectId, 'assessments'] });
    queryClient.invalidateQueries({ queryKey: ['dashboard'] });
  };

  const createMutation = useMutation({
    mutationFn: (data: any) => api.post(`/subjects/${subjectId}/assessments`, data),
    onSuccess: () => {
      invalidateData();
      setIsCreating(false);
      reset();
    },
    onError: (err: any) => setError(err.message || 'Failed to create assessment'),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string, data: any }) => api.put(`/assessments/${id}`, data),
    onSuccess: () => {
      invalidateData();
      setEditingId(null);
    },
    onError: (err: any) => setError(err.message || 'Failed to update assessment'),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/assessments/${id}`),
    onSuccess: () => invalidateData(),
    onError: (err: any) => setError(err.message || 'Failed to delete assessment'),
  });

  const {
    register,
    handleSubmit,
    reset,
    setValue,
    formState: { errors },
  } = useForm<AssessmentForm>({
    resolver: zodResolver(assessmentSchema),
    defaultValues: { status: 'pending' }
  });

  const parsePayload = (data: AssessmentForm) => {
    return {
      name: data.name,
      category: data.category,
      max_marks: Number(data.max_marks),
      status: data.status,
      ...(data.marks ? { marks: Number(data.marks) } : { marks: null }),
      ...(data.weightage ? { weightage: Number(data.weightage) } : { weightage: null }),
      ...(data.scheduled_at ? { scheduled_at: new Date(data.scheduled_at).toISOString() } : { scheduled_at: null }),
    };
  };

  const onSubmitCreate = (data: AssessmentForm) => {
    setError('');
    createMutation.mutate(parsePayload(data));
  };

  const onSubmitUpdate = (data: AssessmentForm) => {
    if (!editingId) return;
    setError('');
    updateMutation.mutate({ id: editingId, data: parsePayload(data) });
  };

  const startEditing = (assessment: Assessment) => {
    setError('');
    setIsCreating(false);
    setEditingId(assessment.id);
    setValue('name', assessment.name);
    setValue('category', assessment.category);
    setValue('max_marks', assessment.max_marks.toString());
    setValue('status', assessment.status);
    setValue('marks', assessment.marks !== null ? assessment.marks.toString() : '');
    setValue('weightage', assessment.weightage !== null ? assessment.weightage.toString() : '');
    setValue('scheduled_at', assessment.scheduled_at ? assessment.scheduled_at.split('T')[0] : '');
  };

  const cancelEditing = () => {
    setEditingId(null);
    reset();
    setError('');
  };

  const handleDelete = (id: string) => {
    if (window.confirm('Are you sure you want to delete this assessment? All associated marks will be removed.')) {
      deleteMutation.mutate(id);
    }
  };

  if (isLoadingSubject || isLoadingAssessments) return <div>Loading...</div>;
  if (!subject) return <div>Subject not found</div>;

  const getStatusBadge = (status: string) => {
    const colors: Record<string, string> = {
      pending: 'bg-yellow-100 text-yellow-800',
      scored: 'bg-green-100 text-green-800',
      absent: 'bg-red-100 text-red-800',
      exempt: 'bg-gray-100 text-gray-800',
    };
    return (
      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${colors[status] || colors.pending}`}>
        {status.toUpperCase()}
      </span>
    );
  };

  const AssessmentFormContent = ({ isEdit = false }) => (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="name">Assessment Name *</Label>
          <Input id="name" placeholder="e.g. Midterm" {...register('name')} />
          {errors.name && <p className="text-sm text-red-600">{errors.name.message}</p>}
        </div>
        <div className="space-y-2">
          <Label htmlFor="category">Category *</Label>
          <Input id="category" placeholder="e.g. Exam" {...register('category')} />
          {errors.category && <p className="text-sm text-red-600">{errors.category.message}</p>}
        </div>
        <div className="space-y-2">
          <Label htmlFor="max_marks">Max Marks *</Label>
          <Input id="max_marks" type="number" step="0.1" {...register('max_marks')} />
          {errors.max_marks && <p className="text-sm text-red-600">{errors.max_marks.message}</p>}
        </div>
        <div className="space-y-2">
          <Label htmlFor="weightage">Weightage (%)</Label>
          <Input id="weightage" type="number" step="0.1" {...register('weightage')} />
          {errors.weightage && <p className="text-sm text-red-600">{errors.weightage.message}</p>}
        </div>
        <div className="space-y-2">
          <Label htmlFor="scheduled_at">Date</Label>
          <Input id="scheduled_at" type="date" {...register('scheduled_at')} />
          {errors.scheduled_at && <p className="text-sm text-red-600">{errors.scheduled_at.message}</p>}
        </div>
        <div className="space-y-2">
          <Label htmlFor="status">Status</Label>
          <select
            id="status"
            className="flex h-10 w-full rounded-md border border-gray-300 bg-transparent px-3 py-2 text-sm placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-400 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
            {...register('status')}
          >
            <option value="pending">Pending</option>
            <option value="scored">Scored</option>
            <option value="absent">Absent</option>
            <option value="exempt">Exempt</option>
          </select>
          {errors.status && <p className="text-sm text-red-600">{errors.status.message}</p>}
        </div>
        <div className="space-y-2 sm:col-span-2">
          <Label htmlFor="marks">Marks</Label>
          <Input id="marks" type="number" step="0.1" placeholder="Leave blank if not graded" {...register('marks')} />
          {errors.marks && <p className="text-sm text-red-600">{errors.marks.message}</p>}
        </div>
      </div>
      <div className="flex gap-2 justify-end mt-4">
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            if (isEdit) cancelEditing();
            else { setIsCreating(false); reset(); setError(''); }
          }}
        >
          Cancel
        </Button>
        <Button type="submit" disabled={isEdit ? updateMutation.isPending : createMutation.isPending}>
          {isEdit ? 'Save Changes' : 'Create Assessment'}
        </Button>
      </div>
    </div>
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Link to={`/app/semesters/${semesterId}`} className="text-gray-500 hover:text-gray-900">
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{subject.name} {subject.code ? `(${subject.code})` : ''}</h1>
          <p className="text-sm text-gray-500">{semester?.name} • Assessments</p>
        </div>
      </div>

      <div className="flex items-center justify-between border-t border-gray-200 pt-6">
        <h2 className="text-xl font-semibold text-gray-900">Assessments</h2>
        {!editingId && (
          <Button onClick={() => { setIsCreating(true); reset(); setError(''); }}>
            Add Assessment
          </Button>
        )}
      </div>

      {error && (
        <div className="p-3 bg-red-50 text-red-700 rounded-md text-sm">
          {error}
        </div>
      )}

      {isCreating && (
        <div className="p-6 bg-white rounded-lg shadow-sm border border-gray-200">
          <form onSubmit={handleSubmit(onSubmitCreate)}>
            <h3 className="text-lg font-medium mb-4">Create New Assessment</h3>
            <AssessmentFormContent />
          </form>
        </div>
      )}

      {!assessments?.length && !isCreating ? (
        <div className="text-center py-12 bg-white rounded-lg border border-dashed border-gray-300">
          <h3 className="text-sm font-medium text-gray-900">No assessments</h3>
          <p className="mt-1 text-sm text-gray-500">Add an assessment to track your progress.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {assessments?.map((assessment) => (
            <div key={assessment.id} className="p-6 bg-white rounded-lg shadow-sm border border-gray-200">
              {editingId === assessment.id ? (
                <form onSubmit={handleSubmit(onSubmitUpdate)}>
                  <h3 className="text-lg font-medium mb-4">Edit Assessment</h3>
                  <AssessmentFormContent isEdit={true} />
                </form>
              ) : (
                <div>
                  <div className="flex justify-between items-start">
                    <div>
                      <div className="flex items-center gap-3">
                        <h3 className="text-lg font-semibold text-gray-900">{assessment.name}</h3>
                        {getStatusBadge(assessment.status)}
                      </div>
                      <p className="text-sm text-gray-500 mt-1">
                        {assessment.category}
                        {assessment.weightage != null && ` • ${assessment.weightage}% weight`}
                        {assessment.scheduled_at && ` • ${new Date(assessment.scheduled_at).toLocaleDateString()}`}
                      </p>
                    </div>
                    <div className="flex gap-2">
                      <Button variant="ghost" size="sm" onClick={() => startEditing(assessment)}>
                        <Edit2 className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => handleDelete(assessment.id)} className="text-red-600 hover:text-red-700">
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                  <div className="mt-4 pt-4 border-t border-gray-100 flex items-end gap-4">
                    <div>
                      <p className="text-sm text-gray-500">Marks</p>
                      <p data-testid="assessment-marks" className="text-2xl font-bold text-gray-900">
                        {assessment.marks !== null ? assessment.marks : '--'} <span className="text-lg text-gray-400 font-normal">/ {assessment.max_marks}</span>
                      </p>
                    </div>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
