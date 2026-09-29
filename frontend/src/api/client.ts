const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000';

export class ApiError extends Error {
  public status: number;
  public data: any;

  constructor(status: number, data: any) {
    super(data?.detail || 'API Error');
    this.status = status;
    this.data = data;
    this.name = 'ApiError';
  }
}

async function fetchWithAuth(url: string, options: RequestInit = {}) {
  const token = localStorage.getItem('token');
  const headers = new Headers(options.headers || {});
  
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }
  
  if (!(options.body instanceof FormData)) {
    headers.set('Content-Type', 'application/json');
  }

  const response = await fetch(`${API_BASE}${url}`, {
    ...options,
    headers,
  });

  if (!response.ok) {
    let errorData;
    try {
      errorData = await response.json();
    } catch {
      errorData = { detail: response.statusText };
    }
    
    // Auto logout on 401
    if (response.status === 401) {
      localStorage.removeItem('token');
      // trigger event or reload for simplistic handling
      window.dispatchEvent(new Event('auth-unauthorized'));
    }
    
    throw new ApiError(response.status, errorData);
  }

  // Handle empty responses
  if (response.status === 204) {
    return null;
  }
  
  return response.json();
}

export const api = {
  get: (url: string) => fetchWithAuth(url, { method: 'GET' }),
  post: (url: string, data?: any) => fetchWithAuth(url, { 
    method: 'POST', 
    body: data instanceof FormData ? data : JSON.stringify(data) 
  }),
  put: (url: string, data?: any) => fetchWithAuth(url, { 
    method: 'PUT', 
    body: data instanceof FormData ? data : JSON.stringify(data) 
  }),
  delete: (url: string) => fetchWithAuth(url, { method: 'DELETE' }),
};
