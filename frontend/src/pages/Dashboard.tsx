import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
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

      <div className="rounded-lg border border-gray-200 bg-white shadow-sm overflow-hidden">
        <div className="border-b border-gray-200 px-6 py-4">
          <h3 className="text-lg font-medium text-gray-900">Subject Performance</h3>
        </div>
        <div className="divide-y divide-gray-200">
          {data.subject_summaries.map((subject) => (
            <Link
              key={subject.subject_id}
              to={`/app/semesters/${subject.semester_id}/subjects/${subject.subject_id}`}
              className="block hover:bg-gray-50 transition-colors"
            >
              <div className="grid grid-cols-1 gap-4 p-6 sm:grid-cols-4 items-center">
                <div>
                  <p className="text-sm font-medium text-gray-900">{subject.subject_name}</p>
                  <p className="text-xs text-gray-500 mt-1">{subject.semester_name}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-500">Earned Points</p>
                  <p className="text-lg font-semibold">{subject.earned_points}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-500 mb-1">Completed Work</p>
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium w-12">
                      {subject.completed_work_percentage !== null
                        ? `${Number(subject.completed_work_percentage).toFixed(0)}%`
                        : 'N/A'}
                    </p>
                    <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
                      {subject.completed_work_percentage !== null && (
                        <div
                          className="h-full bg-blue-500 rounded-full"
                          style={{ width: `${Math.min(100, Math.max(0, Number(subject.completed_work_percentage)))}%` }}
                        />
                      )}
                    </div>
                  </div>
                </div>
                <div>
                  <p className="text-xs text-gray-500 mb-1">Attendance</p>
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium w-12">
                      {subject.attendance_percentage !== null
                        ? `${Number(subject.attendance_percentage).toFixed(0)}%`
                        : 'N/A'}
                    </p>
                    <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
                      {subject.attendance_percentage !== null && (
                        <div
                          className={`h-full rounded-full ${Number(subject.attendance_percentage) >= 75 ? 'bg-green-500' : 'bg-red-500'}`}
                          style={{ width: `${Math.min(100, Math.max(0, Number(subject.attendance_percentage)))}%` }}
                        />
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
