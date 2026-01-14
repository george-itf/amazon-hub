import React, { useState, useCallback } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { Frame } from '@shopify/polaris';
import Nav from './components/Nav.jsx';
import { useAuth } from './context/AuthContext.jsx';
import { InvictaLoading } from './components/ui/index.jsx';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts.jsx';
import KeyboardShortcutsHelp from './components/KeyboardShortcutsHelp.jsx';

// Import pages
import Dashboard from './pages/Dashboard.jsx';
import OrdersPage from './pages/OrdersPage.jsx';
import PicklistsPage from './pages/PicklistsPage.jsx';
import ComponentsPage from './pages/ComponentsPage.jsx';
import BundlesPage from './pages/BundlesPage.jsx';
import ListingsPage from './pages/ListingsPage.jsx';
import ReviewPage from './pages/ReviewPage.jsx';
import ReplenishmentPage from './pages/ReplenishmentPage.jsx';
import ProfitPage from './pages/ProfitPage.jsx';
import LoginPage from './pages/LoginPage.jsx';
import ReturnsPage from './pages/ReturnsPage.jsx';
import AuditPage from './pages/AuditPage.jsx';

/**
 * Layout wrapper that renders the navigation and page content.
 * Enforces authentication: if there is no current user the user is
 * redirected to the login page. Otherwise the application routes are
 * rendered inside a Polaris Frame.
 */
export default function App() {
  const { user, loading } = useAuth();
  const [showShortcuts, setShowShortcuts] = useState(false);

  const handleShowHelp = useCallback(() => {
    setShowShortcuts(true);
  }, []);

  // Enable keyboard shortcuts when user is logged in
  useKeyboardShortcuts({
    onShowHelp: user ? handleShowHelp : undefined,
  });

  // Show loading state while checking auth
  if (loading) {
    return (
      <div style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: '#F6F6F7',
      }}>
        <InvictaLoading message="Loading Amazon Hub Brain..." />
      </div>
    );
  }

  // Render login page separately to avoid the full Frame layout
  if (!user) {
    return (
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="*" element={<Navigate to="/login" />} />
      </Routes>
    );
  }

  return (
    <Frame navigation={<Nav />}>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/orders" element={<OrdersPage />} />
        <Route path="/picklists" element={<PicklistsPage />} />
        <Route path="/components" element={<ComponentsPage />} />
        <Route path="/bundles" element={<BundlesPage />} />
        <Route path="/listings" element={<ListingsPage />} />
        <Route path="/review" element={<ReviewPage />} />
        <Route path="/replenishment" element={<ReplenishmentPage />} />
        <Route path="/profit" element={<ProfitPage />} />
        <Route path="/returns" element={<ReturnsPage />} />
        <Route path="/audit" element={<AuditPage />} />
        <Route path="*" element={<Navigate to="/" />} />
      </Routes>
      <KeyboardShortcutsHelp
        open={showShortcuts}
        onClose={() => setShowShortcuts(false)}
      />
    </Frame>
  );
}
