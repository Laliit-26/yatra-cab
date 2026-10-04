import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider, Toaster, I18nProvider } from '@yatracab/ui';
import { api } from './api.js';
import App from './App.jsx';
import './index.css';

// A referral share link (/?ref=CODE) is captured before the router redirects
// to /login and drops the query string. AuthScreen reads it back from here.
const ref = new URLSearchParams(window.location.search).get('ref');
if (ref) sessionStorage.setItem('yc_ref', ref.toUpperCase());

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false, staleTime: 15000 } },
});

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <I18nProvider>
      <QueryClientProvider client={queryClient}>
      <AuthProvider api={api} roles={['customer']}>
        <BrowserRouter>
          <App />
        </BrowserRouter>
        <Toaster position="top-center" toastOptions={{ style: { borderRadius: '12px' } }} />
      </AuthProvider>
      </QueryClientProvider>
    </I18nProvider>
  </React.StrictMode>
);
