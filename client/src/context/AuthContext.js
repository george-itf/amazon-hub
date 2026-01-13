import React, { createContext, useContext, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { loginWithGoogleToken } from '../utils/api.js';

// Create a React context for authentication
const AuthContext = createContext(null);

/**
 * Provides authentication state and actions to children.  It stores
 * the current user and JWT in localStorage so that sessions survive
 * page reloads.  The `login` function exchanges a Google id_token
 * for a backend JWT.
 */
export function AuthProvider({ children }) {
  const navigate = useNavigate();
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(null);
  // Load stored credentials on mount
  useEffect(() => {
    const stored = localStorage.getItem('auth');
    if (stored) {
      try {
        const { user: u, token: t } = JSON.parse(stored);
        setUser(u);
        setToken(t);
      } catch (err) {
        console.error('Failed to parse stored auth');
      }
    }
  }, []);
  // Persist credentials whenever they change
  useEffect(() => {
    if (user && token) {
      localStorage.setItem('auth', JSON.stringify({ user, token }));
    } else {
      localStorage.removeItem('auth');
    }
  }, [user, token]);

  /**
   * Performs login by sending a Google id_token to the backend.  On
   * success the backend returns a JWT and user profile which are
   * stored in state and localStorage.  If login fails an error is
   * thrown.
   *
   * @param {string} idToken
   */
  async function login(idToken) {
    const { user: u, token: t } = await loginWithGoogleToken(idToken);
    setUser(u);
    setToken(t);
    navigate('/');
  }

  /**
   * Clears the current session and navigates to the login page.
   */
  function logout() {
    setUser(null);
    setToken(null);
    navigate('/login');
  }

  return (
    <AuthContext.Provider value={{ user, token, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

/**
 * Hook for accessing the authentication context.
 */
export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return ctx;
}