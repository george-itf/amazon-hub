import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App.jsx';
import { AppProvider } from '@shopify/polaris';
import enTranslations from '@shopify/polaris/locales/en.json';
import { AuthProvider } from './context/AuthContext.jsx';
import './styles.css';

/**
 * Entrypoint for the React application.  It wraps the root component
 * with `AppProvider` from Polaris to provide UI theming, and with
 * `AuthProvider` to handle authentication state.  React Router is
 * used for client‑side routing.
 */
ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <AppProvider i18n={enTranslations}>
      <BrowserRouter>
        <AuthProvider>
          <App />
        </AuthProvider>
      </BrowserRouter>
    </AppProvider>
  </React.StrictMode>
);