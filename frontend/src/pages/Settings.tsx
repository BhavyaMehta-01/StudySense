import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/client';
import type { ConsentStatus } from '@/types/api';
import { Button } from '@/components/ui/button';

export const CONSENT_TEXT_VERSION = 'v1.0';

export default function Settings() {
  const queryClient = useQueryClient();
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
    return <div>Loading settings...</div>;
  }

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Settings</h1>
        <p className="text-sm text-gray-500 mt-1">Manage your account preferences and data.</p>
      </div>

      <section className="bg-white p-6 rounded-lg shadow-sm border border-gray-200">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Data Donation Consent</h2>
        
        <div className="space-y-4 text-sm text-gray-700">
          <p>
            StudySense is continuously improving. You have the option to donate your academic data
            to help us research and develop future machine learning features (e.g., performance
            prediction or personalized study plans).
          </p>
          <ul className="list-disc pl-5 space-y-2">
            <li><strong>Participation is entirely optional.</strong></li>
            <li>Opting out does <strong>not</strong> disable any normal StudySense functionality. The current required-score calculator and dashboard will continue to work exactly as they do now.</li>
            <li>Your data is currently <strong>not</strong> being used for machine learning. This setting only grants consent for optional future research and improvements.</li>
          </ul>
        </div>

        {error && (
          <div className="mt-6 p-3 bg-red-50 text-red-700 rounded-md text-sm">
            {error}
          </div>
        )}

        {successMsg && (
          <div className="mt-6 p-3 bg-green-50 text-green-700 rounded-md text-sm">
            {successMsg}
          </div>
        )}

        <div className="mt-6 flex items-center justify-between py-4 border-t border-gray-100">
          <div>
            <p className="font-medium text-gray-900">
              Current Status: {consent?.data_donation_consent ? (
                <span className="text-green-600">Opted In</span>
              ) : (
                <span className="text-gray-500">Opted Out</span>
              )}
            </p>
            {consent?.consent_updated_at && (
              <p className="text-xs text-gray-400 mt-1">
                Last updated: {new Date(consent.consent_updated_at).toLocaleString()}
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
