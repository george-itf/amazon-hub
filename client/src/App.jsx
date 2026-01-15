import React, { useState, useCallback, Suspense, lazy } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { Frame, Spinner } from '@shopify/polaris';
import Nav from './components/Nav.jsx';
import { useAuth } from './context/AuthContext.jsx';
import { ProductModalProvider } from './context/ProductModalContext.jsx';
import { InvictaLoading } from './components/ui/index.jsx';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts.jsx';
import KeyboardShortcutsHelp from './components/KeyboardShortcutsHelp.jsx';
import ProductDetailModal from './components/ProductDetailModal.jsx';

// Lazy load pages for code splitting
const Dashboard = lazy(() => import('./pages/Dashboard.jsx'));
const OrdersPage = lazy(() => import('./pages/OrdersPage.jsx'));
const PicklistsPage = lazy(() => import('./pages/PicklistsPage.jsx'));
const ComponentsPage = lazy(() => import('./pages/ComponentsPage.jsx'));
const BundlesPage = lazy(() => import('./pages/BundlesPage.jsx'));
const ListingsPage = lazy(() => import('./pages/ListingsPage.jsx'));
const ReviewPage = lazy(() => import('./pages/ReviewPage.jsx'));
const ReplenishmentPage = lazy(() => import('./pages/ReplenishmentPage.jsx'));
const ProfitPage = lazy(() => import('./pages/ProfitPage.jsx'));
const LoginPage = lazy(() => import('./pages/LoginPage.jsx'));
const ReturnsPage = lazy(() => import('./pages/ReturnsPage.jsx'));
const AuditPage = lazy(() => import('./pages/AuditPage.jsx'));
const AsinAnalyzerPage = lazy(() => import('./pages/AsinAnalyzerPage.jsx'));
const BomReviewPage = lazy(() => import('./pages/BomReviewPage.jsx'));
const AmazonPage = lazy(() => import('./pages/AmazonPage.jsx'));

/**
 * Loading fallback for lazy-loaded pages
 * Returns null initially to prevent flash, only shows spinner after delay
 */
function PageLoader() {
  const [showSpinner, setShowSpinner] = useState(false);

  React.useEffect(() => {
    // Only show spinner if loading takes more than 200ms
    const timer = setTimeout(() => setShowSpinner(true), 200);
    return () => clearTimeout(timer);
  }, []);

  if (!showSpinner) {
    // Return empty div with same layout to prevent content jump
    return <div style={{ minHeight: '200px' }} />;
  }

  return (
    <div style={{
      display: 'flex',
      justifyContent: 'center',
      alignItems: 'center',
      minHeight: '200px',
      padding: '40px',
    }}>
      <Spinner accessibilityLabel="Loading page" size="large" />
    </div>
  );
}

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
      <Suspense fallback={<PageLoader />}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="*" element={<Navigate to="/login" />} />
        </Routes>
      </Suspense>
    );
  }

  return (
    <ProductModalProvider>
      <Frame navigation={<Nav />}>
        <Suspense fallback={<PageLoader />}>
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/orders" element={<OrdersPage />} />
            <Route path="/picklists" element={<PicklistsPage />} />
            <Route path="/components" element={<ComponentsPage />} />
            <Route path="/bundles" element={<BundlesPage />} />
            <Route path="/bom-review" element={<BomReviewPage />} />
            <Route path="/listings" element={<ListingsPage />} />
            <Route path="/review" element={<ReviewPage />} />
            <Route path="/replenishment" element={<ReplenishmentPage />} />
            <Route path="/profit" element={<ProfitPage />} />
            <Route path="/returns" element={<ReturnsPage />} />
            <Route path="/audit" element={<AuditPage />} />
            <Route path="/analyzer" element={<AsinAnalyzerPage />} />
            <Route path="/amazon" element={<AmazonPage />} />
            <Route path="*" element={<Navigate to="/" />} />
          </Routes>
        </Suspense>
        <KeyboardShortcutsHelp
          open={showShortcuts}
          onClose={() => setShowShortcuts(false)}
        />
        <ProductDetailModal />
      </Frame>
    </ProductModalProvider>
  );
}
