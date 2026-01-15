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

/**
 * Amazon Hub Brain - Lazy loaded pages
 *
 * Clean 8-page architecture:
 * 1. Dashboard - Overview, orders, pipeline, quick actions
 * 2. Inventory - Component stock with custom tabs by brand/type
 * 3. Amazon Listings - All Amazon listings with tabs, filters, BOM assignment
 * 4. ASIN Analyzer - Analyze ASINs with scoring
 * 5. Allocation - Intelligent stock distribution across shared components
 * 6. Shipping - Royal Mail integration, parcels, tracking
 * 7. Analytics - Profitability, charts, trends
 * 8. Settings - System configuration
 */

// Core pages
const Dashboard = lazy(() => import('./pages/Dashboard.jsx'));
const InventoryPage = lazy(() => import('./pages/InventoryPage.jsx'));
const AmazonListingsPage = lazy(() => import('./pages/AmazonListingsPage.jsx'));
const AsinAnalyzerPage = lazy(() => import('./pages/AsinAnalyzerPage.jsx'));
const AllocationPage = lazy(() => import('./pages/AllocationPage.jsx'));
const ShippingPage = lazy(() => import('./pages/ShippingPage.jsx'));
const AnalyticsPage = lazy(() => import('./pages/AnalyticsPage.jsx'));
const SettingsPage = lazy(() => import('./pages/SettingsPage.jsx'));

// Auth
const LoginPage = lazy(() => import('./pages/LoginPage.jsx'));

/**
 * Loading fallback for lazy-loaded pages
 */
function PageLoader() {
  const [showSpinner, setShowSpinner] = useState(false);

  React.useEffect(() => {
    const timer = setTimeout(() => setShowSpinner(true), 200);
    return () => clearTimeout(timer);
  }, []);

  if (!showSpinner) {
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
 * Main Application Component
 */
export default function App() {
  const { user, loading } = useAuth();
  const [showShortcuts, setShowShortcuts] = useState(false);

  const handleShowHelp = useCallback(() => {
    setShowShortcuts(true);
  }, []);

  useKeyboardShortcuts({
    onShowHelp: user ? handleShowHelp : undefined,
  });

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
            {/* Core 8-page architecture */}
            <Route path="/" element={<Dashboard />} />
            <Route path="/inventory" element={<InventoryPage />} />
            <Route path="/listings" element={<AmazonListingsPage />} />
            <Route path="/analyzer" element={<AsinAnalyzerPage />} />
            <Route path="/allocation" element={<AllocationPage />} />
            <Route path="/shipping" element={<ShippingPage />} />
            <Route path="/analytics" element={<AnalyticsPage />} />
            <Route path="/settings" element={<SettingsPage />} />

            {/* Catch-all redirect to dashboard */}
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
