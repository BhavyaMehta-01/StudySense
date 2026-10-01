import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, test, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { api } from '@/api/client';
import Settings, { CONSENT_TEXT_VERSION } from './Settings';

vi.mock('@/api/client', () => ({
  api: {
    get: vi.fn(),
    put: vi.fn(),
  }
}));

describe('Settings Page - Data Donation Consent', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    vi.clearAllMocks();
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
  });

  const renderComponent = () => {
    return render(
      <QueryClientProvider client={queryClient}>
        <Settings />
      </QueryClientProvider>
    );
  };

  test('displays loading state initially', () => {
    (api.get as any).mockReturnValue(new Promise(() => {})); // Never resolves
    renderComponent();
    expect(screen.getByText('Loading settings...')).toBeInTheDocument();
  });

  test('displays opted-out state correctly', async () => {
    (api.get as any).mockResolvedValue({
      data_donation_consent: false,
      consent_updated_at: null,
      consent_text_version: null,
    });

    renderComponent();

    await waitFor(() => {
      expect(screen.getByText('Opted Out')).toBeInTheDocument();
    });
    
    expect(screen.getByRole('button', { name: 'Opt In' })).toBeInTheDocument();
  });

  test('displays opted-in state correctly', async () => {
    (api.get as any).mockResolvedValue({
      data_donation_consent: true,
      consent_updated_at: '2023-10-01T12:00:00Z',
      consent_text_version: 'v1.0',
    });

    renderComponent();

    await waitFor(() => {
      expect(screen.getByText('Opted In')).toBeInTheDocument();
    });
    
    expect(screen.getByRole('button', { name: 'Opt Out' })).toBeInTheDocument();
  });

  test('successful update from opted-out to opted-in', async () => {
    (api.get as any).mockResolvedValue({
      data_donation_consent: false,
      consent_updated_at: null,
      consent_text_version: null,
    });

    renderComponent();

    const optInButton = await screen.findByRole('button', { name: 'Opt In' });
    
    (api.put as any).mockResolvedValue({
      data_donation_consent: true,
      consent_updated_at: '2023-10-01T12:05:00Z',
      consent_text_version: CONSENT_TEXT_VERSION,
    });

    fireEvent.click(optInButton);

    await waitFor(() => {
      expect(api.put).toHaveBeenCalledWith('/consent', {
        data_donation_consent: true,
        consent_text_version: CONSENT_TEXT_VERSION,
      });
      expect(screen.getByText('Data donation consent successfully granted.')).toBeInTheDocument();
      expect(screen.getByText('Opted In')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Opt Out' })).toBeInTheDocument();
    });
  });

  test('failed update shows error and maintains previous state', async () => {
    (api.get as any).mockResolvedValue({
      data_donation_consent: false,
      consent_updated_at: null,
      consent_text_version: null,
    });

    renderComponent();

    const optInButton = await screen.findByRole('button', { name: 'Opt In' });
    
    (api.put as any).mockRejectedValue(new Error('Network Error'));

    fireEvent.click(optInButton);

    await waitFor(() => {
      expect(screen.getByText('Network Error')).toBeInTheDocument();
      // Should still be opted out
      expect(screen.getByText('Opted Out')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Opt In' })).toBeInTheDocument();
    });
  });
});
