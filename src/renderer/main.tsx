import React from 'react';
import { createRoot } from 'react-dom/client';
import { SnackbarProvider } from 'notistack';
import { App } from './App';
import './styles.css';

createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <SnackbarProvider
      maxSnack={4}
      autoHideDuration={3500}
      anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
      preventDuplicate
    >
      <App />
    </SnackbarProvider>
  </React.StrictMode>
);
