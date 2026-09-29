import { useQuery } from '@tanstack/react-query';
import { api } from '@/api/client';
import type { DashboardSummary } from '@/types/api';

export default function Dashboard() {
  const { data, isLoading, error } = useQuery<DashboardSummary>({
    queryKey: ['dashboard'],
    queryFn: () => api.get('/dashboard'),
  });

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <p className="text-gray-500">Loading dashboard data...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg bg-red-50 p-6 text-center text-red-700">
        <h3 className="text-lg font-medium">Error loading dashboard</h3>
        <p className="mt-2 text-sm">Please try again later.</p>
      </div>
    );
  }

  if (!data || data.total_subjects === 0) {
    return (
      <div className="rounded-lg border border-gray-200 bg-white p-12 text-center">
        <h3 className="text-lg font-medium text-gray-900">No data available</h3>
        <p className="mt-2 text-sm text-gray-500">
          You haven't added any academic data yet.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
          <p className="text-sm font-medium text-gray-500">Total Semesters</p>
          <p className="mt-2 text-3xl font-semibold text-gray-900">{data.total_semesters}</p>
        </div>
        <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
          <p className="text-sm font-medium text-gray-500">Total Subjects</p>
          <p className="mt-2 text-3xl font-semibold text-gray-900">{data.total_subjects}</p>
        </div>
      </div>

      <div className="rounded-lg border border-gray-200 bg-white shadow-sm">
        <div className="border-b border-gray-200 px-6 py-4">
          <h3 className="text-lg font-medium text-gray-900">Subject Performance</h3>
        </div>
        <div className="divide-y divide-gray-200">
          {data.subject_summaries.map((subject) => (
            <div key={subject.subject_id} className="grid grid-cols-1 gap-4 p-6 sm:grid-cols-4 items-center">
              <div>
                <p className="text-sm font-medium text-gray-900">{subject.subject_name}</p>
              </div>
              <div>
                <p className="text-xs text-gray-500">Earned Points</p>
                <p className="text-lg font-semibold">{subject.earned_points}</p>
              </div>
              <div>
                <p className="text-xs text-gray-500">Completed Work</p>
                <p className="text-lg font-semibold">
                  {subject.completed_work_percentage !== null 
                    ? `${Number(subject.completed_work_percentage).toFixed(2)}%` 
                    : 'N/A'}
                </p>
              </div>
              <div>
                <p className="text-xs text-gray-500">Attendance</p>
                <p className="text-lg font-semibold">
                  {subject.attendance_percentage !== null 
                    ? `${Number(subject.attendance_percentage).toFixed(2)}%` 
                    : 'N/A'}
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
