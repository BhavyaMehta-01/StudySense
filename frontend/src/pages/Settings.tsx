import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/client';
import type { ConsentStatus } from '@/types/api';
import { Button } from '@/components/ui/button';
import { useTheme } from '@/hooks/useTheme';
import { Sun, Moon, Monitor } from 'lucide-react';
import { cn } from '@/lib/utils';

export const CONSENT_TEXT_VERSION = 'v1.0';

export default function Settings() {
  const queryClient = useQueryClient();
  const { theme, setTheme } = useTheme();
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const { data: consent, isLoading } = useQuery<ConsentStatus>({
    queryKey: ['consent'],
    queryFn: () => api.get('/consent'),
  });

  const updateMutation = useMutation({
    mutationFn: async (newConsentValue: boolean) => {
      const payload = {
        data_donation_consent: newConsentValue,
        consent_text_version: CONSENT_TEXT_VERSION,
      };
      return api.put('/consent', payload) as Promise<ConsentStatus>;
    },
    onSuccess: (data) => {
      queryClient.setQueryData(['consent'], data);
      setError(null);
      setSuccessMsg(`Data donation consent successfully ${data.data_donation_consent ? 'granted' : 'revoked'}.`);
      
      // Clear success message after 3 seconds
      setTimeout(() => setSuccessMsg(null), 3000);
    },
    onError: (err: any) => {
      setError(err?.data?.detail || err.message || 'Failed to update consent status.');
      setSuccessMsg(null);
    },
  });

  const handleToggle = () => {
    if (consent) {
      updateMutation.mutate(!consent.data_donation_consent);
    }
  };

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <p className="text-sm font-medium text-muted-foreground">Loading settings...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">Settings</h1>
        <p className="text-sm text-muted-foreground mt-1">Manage your account preferences, visual theme, and data.</p>
      </div>

      <section className="bg-card/85 backdrop-blur-md p-6 rounded-xl shadow-xs border border-border text-card-foreground">
        <h2 className="text-lg font-semibold text-foreground mb-1">Appearance</h2>
        <p className="text-sm text-muted-foreground mb-4">Choose your preferred visual theme for StudySense.</p>
        <div className="flex flex-wrap gap-3" role="group" aria-label="Theme selection">
          <Button
            type="button"
            variant={theme === 'light' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setTheme('light')}
            className={cn(
              "gap-2 transition-all",
              theme === 'light'
                ? "ring-2 ring-primary/40 font-semibold shadow-xs"
                : "border-border text-foreground hover:bg-muted"
            )}
            aria-pressed={theme === 'light'}
          >
            <Sun className="h-4 w-4 text-amber-500" />
            <span>Light</span>
          </Button>
          <Button
            type="button"
            variant={theme === 'dark' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setTheme('dark')}
            className={cn(
              "gap-2 transition-all",
              theme === 'dark'
                ? "ring-2 ring-primary/40 font-semibold shadow-xs"
                : "border-border text-foreground hover:bg-muted"
            )}
            aria-pressed={theme === 'dark'}
          >
            <Moon className="h-4 w-4 text-indigo-400" />
            <span>Dark</span>
          </Button>
          <Button
            type="button"
            variant={theme === 'system' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setTheme('system')}
            className={cn(
              "gap-2 transition-all",
              theme === 'system'
                ? "ring-2 ring-primary/40 font-semibold shadow-xs"
                : "border-border text-foreground hover:bg-muted"
            )}
            aria-pressed={theme === 'system'}
          >
            <Monitor className="h-4 w-4 text-cyan-400" />
            <span>System</span>
          </Button>
        </div>
      </section>

      <section className="bg-card/85 backdrop-blur-md p-6 rounded-xl shadow-xs border border-border text-card-foreground">
        <h2 className="text-lg font-semibold text-foreground mb-4">Data Donation Consent</h2>
        
        <div className="space-y-4 text-sm text-muted-foreground">
          <p>
            StudySense is continuously improving. You have the option to donate your academic data
            to help us research and develop future machine learning features (e.g., performance
            prediction or personalized study plans).
          </p>
          <ul className="list-disc pl-5 space-y-2">
            <li><strong className="text-foreground">Participation is entirely optional.</strong></li>
            <li>Opting out does <strong className="text-foreground">not</strong> disable any normal StudySense functionality. The current required-score calculator and dashboard will continue to work exactly as they do now.</li>
            <li>Your data is currently <strong className="text-foreground">not</strong> being used for machine learning. This setting only grants consent for optional future research and improvements.</li>
          </ul>
        </div>

        {error && (
          <div role="alert" className="mt-6 p-3 bg-destructive/10 text-destructive border border-destructive/20 rounded-md text-sm">
            {error}
          </div>
        )}

        {successMsg && (
          <div role="status" className="mt-6 p-3 bg-success/10 text-success border border-success/20 rounded-md text-sm">
            {successMsg}
          </div>
        )}

        <div className="mt-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4 py-4 border-t border-border">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-foreground">Current Status:</span>
              {consent?.data_donation_consent ? (
                <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
                  Opted In
                </span>
              ) : (
                <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20">
                  Opted Out
                </span>
              )}
            </div>
            {consent?.consent_updated_at && (
              <p className="text-xs text-muted-foreground mt-1.5">
                Last updated: <span className="text-foreground/80 font-medium">{new Date(consent.consent_updated_at).toLocaleString()}</span>
              </p>
            )}
          </div>
          <Button
            onClick={handleToggle}
            disabled={updateMutation.isPending || !consent}
            variant={consent?.data_donation_consent ? 'destructive' : 'default'}
          >
            {updateMutation.isPending ? 'Updating...' : (consent?.data_donation_consent ? 'Opt Out' : 'Opt In')}
          </Button>
        </div>
      </section>
    </div>
  );
}
