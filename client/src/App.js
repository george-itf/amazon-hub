import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { Frame, Page } from '@shopify/polaris';
import Nav from './components/Nav.js';
import { useAuth } from './context/AuthContext.js';

// Import pages
import Dashboard from './pages/Dashboard.js';
import OrdersPage from './pages/OrdersPage.js';
import PicklistsPage from './pages/PicklistsPage.js';
import ComponentsPage from './pages/ComponentsPage.js';
import BundlesPage from './pages/BundlesPage.js';
import ListingsPage from './pages/ListingsPage.js';
import ReviewPage from './pages/ReviewPage.js';
import ReplenishmentPage from './pages/ReplenishmentPage.js';
import ProfitPage from './pages/ProfitPage.js';
import LoginPage from './pages/LoginPage.js';

/**
 * Layout wrapper that renders the navigation and page content.  It
 * enforces authentication: if there is no current user the user is
 * redirected to the login page.  Otherwise the application routes are
 * rendered inside a Polaris `Frame`.
 */
export default function App() {
  const { user } = useAuth();
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
        <Route path="*" element={<Navigate to="/" />} />
      </Routes>
    </Frame>
  );
}