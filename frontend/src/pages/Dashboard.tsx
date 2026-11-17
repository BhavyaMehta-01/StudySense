import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { api } from '@/api/client';
import type { DashboardSummary } from '@/types/api';
import StudyPlanProgress from '@/components/dashboard/StudyPlanProgress';

export default function Dashboard() {
  const { data, isLoading, error } = useQuery<DashboardSummary>({
    queryKey: ['dashboard'],
    queryFn: () => api.get('/dashboard'),
  });

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <p className="text-sm font-medium text-muted-foreground">Loading dashboard data...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-xl border border-destructive/20 bg-destructive/10 p-6 text-center text-destructive">
        <h3 className="text-lg font-semibold">Error loading dashboard</h3>
        <p className="mt-2 text-sm opacity-90">Please try again later.</p>
      </div>
    );
  }

  if (!data || data.total_subjects === 0) {
    return (
      <div className="rounded-xl border border-border bg-card p-12 text-center text-card-foreground shadow-xs">
        <h3 className="text-lg font-semibold text-foreground">No data available</h3>
        <p className="mt-2 text-sm text-muted-foreground">
          You haven't added any academic data yet.
        </p>
      </div>
    );
  }

  const subjectMap = data.subject_summaries?.reduce<Record<string, string>>((acc, s) => {
    acc[s.subject_id] = s.subject_name;
    return acc;
  }, {}) || {};

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-xl border border-border bg-card/85 backdrop-blur-md p-6 shadow-xs text-card-foreground">
          <p className="text-sm font-medium text-muted-foreground">Total Semesters</p>
          <p className="mt-2 text-3xl font-bold tracking-tight text-foreground tabular-nums">{data.total_semesters}</p>
        </div>
        <div className="rounded-xl border border-border bg-card/85 backdrop-blur-md p-6 shadow-xs text-card-foreground">
          <p className="text-sm font-medium text-muted-foreground">Total Subjects</p>
          <p className="mt-2 text-3xl font-bold tracking-tight text-foreground tabular-nums">{data.total_subjects}</p>
        </div>
      </div>

      <StudyPlanProgress subjectMap={subjectMap} />

      <div className="rounded-xl border border-border bg-card/85 backdrop-blur-md shadow-xs overflow-hidden text-card-foreground">
        <div className="border-b border-border px-6 py-4">
          <h3 className="text-base font-semibold text-foreground">Subject Performance</h3>
        </div>
        <div className="divide-y divide-border">
          {data.subject_summaries.map((subject) => (
            <Link
              key={subject.subject_id}
              to={`/app/semesters/${subject.semester_id}/subjects/${subject.subject_id}`}
              className="block hover:bg-muted/40 transition-colors focus-visible:outline-none focus-visible:bg-muted/50"
            >
              <div className="grid grid-cols-1 gap-4 p-6 sm:grid-cols-2 lg:grid-cols-5 items-center">
                <div>
                  <p className="text-sm font-semibold text-foreground">{subject.subject_name}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{subject.semester_name}</p>
                </div>
                <div>
                  <p className="text-xs font-medium text-muted-foreground">Earned Points</p>
                  <p className="text-lg font-bold text-foreground tabular-nums">{subject.earned_points}</p>
                </div>
                <div>
                  <p className="text-xs font-medium text-muted-foreground mb-1">Current Average</p>
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium text-foreground w-12 tabular-nums">
                      {subject.completed_work_percentage !== null
                        ? `${Number(subject.completed_work_percentage).toFixed(0)}%`
                        : 'N/A'}
                    </p>
                    <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
                      {subject.completed_work_percentage !== null && (
                        <div
                          className="h-full bg-brand-secondary rounded-full transition-all duration-300"
                          style={{ width: `${Math.min(100, Math.max(0, Number(subject.completed_work_percentage)))}%` }}
                        />
                      )}
                    </div>
                  </div>
                </div>
                <div>
                  <p className="text-xs font-medium text-muted-foreground mb-1">Course Completion</p>
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium text-foreground w-12 tabular-nums">
                      {subject.completed_weight !== null && subject.completed_weight !== undefined
                        ? `${Number(subject.completed_weight).toFixed(0)}%`
                        : '0%'}
                    </p>
                    <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
                      {subject.completed_weight !== null && subject.completed_weight !== undefined && (
                        <div
                          className="h-full bg-primary rounded-full transition-all duration-300"
                          style={{ width: `${Math.min(100, Math.max(0, Number(subject.completed_weight)))}%` }}
                        />
                      )}
                    </div>
                  </div>
                </div>
                <div>
                  <p className="text-xs font-medium text-muted-foreground mb-1">Attendance</p>
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium text-foreground w-12 tabular-nums">
                      {subject.attendance_percentage !== null
                        ? `${Number(subject.attendance_percentage).toFixed(0)}%`
                        : 'N/A'}
                    </p>
                    <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
                      {subject.attendance_percentage !== null && (
                        <div
                          className={`h-full rounded-full transition-all duration-300 ${
                            Number(subject.attendance_percentage) >= 75 ? 'bg-success' : 'bg-destructive'
                          }`}
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
