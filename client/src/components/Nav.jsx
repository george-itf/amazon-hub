import React, { useState, useCallback, useRef, useEffect } from 'react';
import { Navigation, Text, BlockStack, Modal, Button, Icon } from '@shopify/polaris';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  HomeIcon,
  InventoryIcon,
  ProductIcon,
  SearchIcon,
  TargetIcon,
  DeliveryIcon,
  ChartVerticalFilledIcon,
  SettingsIcon,
  ExitIcon,
  PersonIcon,
  ClockIcon,
} from '@shopify/polaris-icons';
import { useAuth } from '../context/AuthContext.jsx';

/**
 * Amazon Hub Brain Navigation
 *
 * Accessibility Features (WCAG 2.1 AA Compliant):
 * - High contrast text (4.5:1 ratio minimum)
 * - Keyboard navigation with visible focus indicators
 * - ARIA attributes for screen readers
 * - Logout separated from main nav with confirmation dialog
 * - Arrow key navigation within nav list
 *
 * Navigation grouped by ops intent (P2-01 UX Audit):
 *
 * Command:
 *   - Dashboard - Overview, orders, pipeline, quick actions
 *
 * Catalogue:
 *   - Inventory - Component stock with custom tabs by brand/type
 *   - Listings - All Amazon listings with tabs, filters, BOM assignment
 *   - ASIN Analyzer - Analyze ASINs with scoring
 *
 * Fulfilment:
 *   - Allocation - Intelligent stock distribution across shared components
 *   - Shipping - Royal Mail integration, parcels, tracking
 *
 * Insights:
 *   - Analytics - Profitability, charts, trends
 *
 * Admin:
 *   - Settings - System configuration
 *   - Audit - Activity log
 */
export default function Nav() {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const [logoutModalOpen, setLogoutModalOpen] = useState(false);
  const [focusedIndex, setFocusedIndex] = useState(-1);
  const navRef = useRef(null);

  // Navigation items grouped by ops intent (P2-01 UX Audit)

  // Command section - Central control hub
  const commandItems = [
    {
      label: 'Dashboard',
      url: '/',
      icon: HomeIcon,
      exactMatch: true,
    },
  ];

  // Catalogue section - Product & inventory management
  const catalogueItems = [
    {
      label: 'Inventory',
      url: '/inventory',
      icon: InventoryIcon,
    },
    {
      label: 'Listings',
      url: '/listings',
      icon: ProductIcon,
    },
    {
      label: 'ASIN Analyzer',
      url: '/analyzer',
      icon: SearchIcon,
    },
  ];

  // Fulfilment section - Order execution & shipping
  const fulfilmentItems = [
    {
      label: 'Allocation',
      url: '/allocation',
      icon: TargetIcon,
    },
    {
      label: 'Shipping',
      url: '/shipping',
      icon: DeliveryIcon,
    },
  ];

  // Insights section - Analytics & reporting
  const insightsItems = [
    {
      label: 'Analytics',
      url: '/analytics',
      icon: ChartVerticalFilledIcon,
    },
  ];

  // Admin section - System settings & audit
  const adminItems = [
    {
      label: 'Settings',
      url: '/settings',
      icon: SettingsIcon,
    },
    {
      label: 'Audit',
      url: '/audit',
      icon: ClockIcon,
    },
  ];

  // Calculate total items for keyboard navigation
  const allNavItems = [...commandItems, ...catalogueItems, ...fulfilmentItems, ...insightsItems, ...adminItems];

  // Handle logout confirmation
  const handleLogoutClick = useCallback(() => {
    setLogoutModalOpen(true);
  }, []);

  const handleLogoutConfirm = useCallback(() => {
    setLogoutModalOpen(false);
    logout();
  }, [logout]);

  const handleLogoutCancel = useCallback(() => {
    setLogoutModalOpen(false);
  }, []);

  // Keyboard navigation handler for arrow keys
  const handleKeyDown = useCallback((event, index) => {
    const navItems = navRef.current?.querySelectorAll('[data-nav-item]');
    if (!navItems) return;

    let newIndex = index;

    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        newIndex = Math.min(index + 1, navItems.length - 1);
        break;
      case 'ArrowUp':
        event.preventDefault();
        newIndex = Math.max(index - 1, 0);
        break;
      case 'Home':
        event.preventDefault();
        newIndex = 0;
        break;
      case 'End':
        event.preventDefault();
        newIndex = navItems.length - 1;
        break;
      default:
        return;
    }

    if (newIndex !== index) {
      setFocusedIndex(newIndex);
      navItems[newIndex]?.focus();
    }
  }, []);

  // Map navigation items with accessibility enhancements
  const mapNavItems = (items) => {
    return items.map((item, index) => {
      const isSelected = item.exactMatch
        ? location.pathname === item.url
        : location.pathname.startsWith(item.url);

      return {
        ...item,
        selected: isSelected,
        onClick: () => navigate(item.url),
        // ARIA: Mark current page
        ...(isSelected && { 'aria-current': 'page' }),
      };
    });
  };

  return (
    <>
      {/* Accessibility-enhanced navigation styles */}
      <style>{`
        /* ============================================
           WCAG AA CONTRAST FIXES
           Background: #1E293B (dark slate)
           Text needs 4.5:1 contrast ratio for AA
           ============================================ */

        /* Navigation section headings - subdued, smaller, non-clickable */
        .Polaris-Navigation__SectionHeading {
          color: #94A3B8 !important;
          font-size: 11px !important;
          font-weight: 600 !important;
          text-transform: uppercase !important;
          letter-spacing: 0.05em !important;
          padding: 12px 20px 6px 20px !important;
          pointer-events: none !important;
          user-select: none !important;
        }

        /* First section header needs less top padding */
        .Polaris-Navigation__Section:first-child .Polaris-Navigation__SectionHeading {
          padding-top: 8px !important;
        }

        /* Navigation text - using #FFFFFF on #1E293B = 13.5:1 contrast */
        .Polaris-Navigation__Text {
          color: #FFFFFF !important;
        }

        .Polaris-Navigation__Item:hover .Polaris-Navigation__Text {
          color: #FFFFFF !important;
        }

        .Polaris-Navigation__SecondaryNavigation .Polaris-Navigation__Text {
          color: #F1F5F9 !important;
        }

        .Polaris-Navigation__Item--selected .Polaris-Navigation__Text {
          color: #000000 !important;
        }

        /* Icons - high contrast white */
        .Polaris-Navigation__Icon svg {
          fill: #F8FAFC !important;
        }

        .Polaris-Navigation__Item--selected .Polaris-Navigation__Icon svg {
          fill: #000000 !important;
        }

        /* ============================================
           KEYBOARD NAVIGATION & FOCUS INDICATORS
           Visible focus ring for keyboard users
           ============================================ */

        /* Remove default browser outline and add custom focus ring */
        .Polaris-Navigation__Item:focus {
          outline: none !important;
          box-shadow: 0 0 0 3px #FF9900, 0 0 0 5px rgba(255, 153, 0, 0.3) !important;
          border-radius: 8px;
        }

        .Polaris-Navigation__Item:focus-visible {
          outline: none !important;
          box-shadow: 0 0 0 3px #FF9900, 0 0 0 5px rgba(255, 153, 0, 0.3) !important;
          border-radius: 8px;
        }

        /* Focus within for nested focusable elements */
        .Polaris-Navigation__Item:focus-within {
          box-shadow: 0 0 0 3px #FF9900, 0 0 0 5px rgba(255, 153, 0, 0.3) !important;
          border-radius: 8px;
        }

        /* Selected item styling - high contrast active state */
        .Polaris-Navigation__Item--selected {
          background-color: #FF9900 !important;
        }

        .Polaris-Navigation__Item--selected:focus {
          box-shadow: 0 0 0 3px #FFFFFF, 0 0 0 5px rgba(255, 255, 255, 0.3) !important;
        }

        /* ============================================
           ADMIN SECTION STYLING
           Visually separated at bottom of navigation
           ============================================ */

        /* Admin section visual separation */
        .hub-nav-admin-section {
          margin-top: auto;
          padding-top: 8px;
          border-top: 1px solid rgba(255, 255, 255, 0.1);
        }

        /* ============================================
           LOGOUT SECTION STYLING
           Visually separated from main navigation
           ============================================ */

        /* Logout section visual separation */
        .hub-nav-logout-section {
          padding-top: 8px;
          border-top: 1px solid rgba(255, 255, 255, 0.1);
        }

        .hub-nav-logout-section .Polaris-Navigation__Item {
          background-color: rgba(220, 38, 38, 0.1) !important;
          border: 1px solid rgba(220, 38, 38, 0.3);
        }

        .hub-nav-logout-section .Polaris-Navigation__Item:hover {
          background-color: rgba(220, 38, 38, 0.2) !important;
          border-color: rgba(220, 38, 38, 0.5);
        }

        .hub-nav-logout-section .Polaris-Navigation__Item:focus {
          box-shadow: 0 0 0 3px #DC2626, 0 0 0 5px rgba(220, 38, 38, 0.3) !important;
        }

        .hub-nav-logout-section .Polaris-Navigation__Text {
          color: #FCA5A5 !important;
        }

        .hub-nav-logout-section .Polaris-Navigation__Icon svg {
          fill: #FCA5A5 !important;
        }

        /* ============================================
           USER ACCOUNT SECTION
           ============================================ */

        .hub-nav-user-section {
          padding: 12px 16px;
          margin: 8px;
          background: rgba(255, 255, 255, 0.05);
          border-radius: 8px;
          border-bottom: 1px solid rgba(255, 255, 255, 0.1);
        }

        .hub-nav-user-name {
          color: #FFFFFF;
          font-weight: 500;
          font-size: 14px;
        }

        .hub-nav-user-email {
          color: #94A3B8;
          font-size: 12px;
          margin-top: 2px;
        }

        /* ============================================
           SKIP LINK FOR KEYBOARD USERS
           ============================================ */

        .hub-skip-link {
          position: absolute;
          top: -40px;
          left: 0;
          background: #FF9900;
          color: #000000;
          padding: 8px 16px;
          z-index: 100;
          font-weight: 600;
          border-radius: 0 0 8px 0;
          transition: top 0.2s;
        }

        .hub-skip-link:focus {
          top: 0;
        }
      `}</style>

      {/* Main Navigation with ARIA landmarks */}
      <Navigation
        location={location.pathname}
        ariaLabelledBy="nav-heading"
      >
        {/* Brand Header */}
        <div style={{
          padding: '16px 20px',
          borderBottom: '1px solid rgba(255,255,255,0.2)',
          marginBottom: '8px',
        }}>
          <BlockStack gap="100">
            <Text variant="headingMd" fontWeight="bold" id="nav-heading">
              <span style={{ color: '#FF9900' }}>Amazon Hub</span>
            </Text>
            <Text variant="bodySm">
              <span style={{ color: '#E2E8F0' }}>Invicta Tools & Fixings</span>
            </Text>
          </BlockStack>
        </div>

        {/* User Account Section - separated from nav items */}
        {user && (
          <div
            className="hub-nav-user-section"
            role="region"
            aria-label="User account"
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Icon source={PersonIcon} tone="base" />
              <div>
                <div className="hub-nav-user-name">
                  {user?.name || 'User'}
                </div>
                {user?.email && (
                  <div className="hub-nav-user-email">
                    {user.email}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Navigation grouped by ops intent (P2-01) */}
        <div ref={navRef} role="navigation" aria-label="Main navigation">
          {/* Command Section */}
          <Navigation.Section
            title="Command"
            items={mapNavItems(commandItems).map((item, index) => ({
              ...item,
              accessibilityLabel: `${item.label}${item.selected ? ' (current page)' : ''}`,
              onKeyDown: (e) => handleKeyDown(e, index),
              'data-nav-item': true,
            }))}
          />

          {/* Catalogue Section */}
          <Navigation.Section
            title="Catalogue"
            items={mapNavItems(catalogueItems).map((item, index) => ({
              ...item,
              accessibilityLabel: `${item.label}${item.selected ? ' (current page)' : ''}`,
              onKeyDown: (e) => handleKeyDown(e, commandItems.length + index),
              'data-nav-item': true,
            }))}
          />

          {/* Fulfilment Section */}
          <Navigation.Section
            title="Fulfilment"
            items={mapNavItems(fulfilmentItems).map((item, index) => ({
              ...item,
              accessibilityLabel: `${item.label}${item.selected ? ' (current page)' : ''}`,
              onKeyDown: (e) => handleKeyDown(e, commandItems.length + catalogueItems.length + index),
              'data-nav-item': true,
            }))}
          />

          {/* Insights Section */}
          <Navigation.Section
            title="Insights"
            items={mapNavItems(insightsItems).map((item, index) => ({
              ...item,
              accessibilityLabel: `${item.label}${item.selected ? ' (current page)' : ''}`,
              onKeyDown: (e) => handleKeyDown(e, commandItems.length + catalogueItems.length + fulfilmentItems.length + index),
              'data-nav-item': true,
            }))}
          />
        </div>

        {/* Admin Section - visually separated at bottom */}
        <div role="navigation" aria-label="Admin navigation" className="hub-nav-admin-section">
          <Navigation.Section
            title="Admin"
            items={mapNavItems(adminItems).map((item, index) => ({
              ...item,
              accessibilityLabel: `${item.label}${item.selected ? ' (current page)' : ''}`,
              onKeyDown: (e) => handleKeyDown(e, commandItems.length + catalogueItems.length + fulfilmentItems.length + insightsItems.length + index),
              'data-nav-item': true,
            }))}
          />
        </div>

        {/* Logout Section - Visually separated with divider */}
        <div
          className="hub-nav-logout-section"
          role="region"
          aria-label="Account actions"
        >
          <Navigation.Section
            items={[
              {
                label: 'Sign Out',
                icon: ExitIcon,
                onClick: handleLogoutClick,
                accessibilityLabel: 'Sign out of your account. This will open a confirmation dialog.',
              },
            ]}
          />
        </div>
      </Navigation>

      {/* Logout Confirmation Modal */}
      <Modal
        open={logoutModalOpen}
        onClose={handleLogoutCancel}
        title="Sign Out"
        primaryAction={{
          content: 'Sign Out',
          onAction: handleLogoutConfirm,
          destructive: true,
        }}
        secondaryActions={[
          {
            content: 'Cancel',
            onAction: handleLogoutCancel,
          },
        ]}
      >
        <Modal.Section>
          <Text as="p">
            Are you sure you want to sign out of Amazon Hub? You will need to sign in again to access your account.
          </Text>
        </Modal.Section>
      </Modal>
    </>
  );
}
