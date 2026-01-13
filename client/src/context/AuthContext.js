import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import * as api from '../utils/api.js';

// Create a React context for authentication
const AuthContext = createContext(null);

/**
 * Provides authentication state and actions to children.
 * Uses session-based authentication with cookies.
 */
export function AuthProvider({ children }) {
  const navigate = useNavigate();
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Check session on mount
  useEffect(() => {
    checkSession();
  }, []);

  /**
   * Check if there's an active session
   */
  const checkSession = useCallback(async () => {
    try {
      setLoading(true);
      const userData = await api.getCurrentUser();
      setUser(userData);
      setError(null);
    } catch (err) {
      // Session not valid or expired
      setUser(null);
      if (err.status !== 401) {
        console.error('Session check error:', err);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  /**
   * Log in with email and password
   * @param {string} email
   * @param {string} password
   */
  async function login(email, password) {
    try {
      setError(null);
      const result = await api.login(email, password);
      setUser(result.user);
      navigate('/');
      return result;
    } catch (err) {
      setError(err.message);
      throw err;
    }
  }

  /**
   * Register a new user
   * @param {string} email
   * @param {string} password
   * @param {string} name
   */
  async function register(email, password, name) {
    try {
      setError(null);
      const result = await api.register(email, password, name);
      setUser(result.user);
      navigate('/');
      return result;
    } catch (err) {
      setError(err.message);
      throw err;
    }
  }

  /**
   * Log out and clear session
   */
  async function logout() {
    try {
      await api.logout();
    } catch (err) {
      console.error('Logout error:', err);
    } finally {
      setUser(null);
      navigate('/login');
    }
  }

  /**
   * Change user password
   * @param {string} currentPassword
   * @param {string} newPassword
   */
  async function changePassword(currentPassword, newPassword) {
    try {
      setError(null);
      await api.changePassword(currentPassword, newPassword);
    } catch (err) {
      setError(err.message);
      throw err;
    }
  }

  /**
   * Check if user has admin role
   */
  const isAdmin = user?.role === 'ADMIN';

  /**
   * Check if user has staff role (staff or admin)
   */
  const isStaff = user?.role === 'ADMIN' || user?.role === 'STAFF';

  const value = {
    user,
    loading,
    error,
    isAdmin,
    isStaff,
    login,
    logout,
    register,
    changePassword,
    checkSession,
  };

  return (
    <AuthContext.Provider value={value}>
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
