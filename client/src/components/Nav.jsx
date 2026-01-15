import React from 'react';
import { Navigation, Text, Badge, InlineStack, BlockStack } from '@shopify/polaris';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  HomeIcon,
  OrderIcon,
  InventoryIcon,
  ProductIcon,
  ChartVerticalFilledIcon,
  SettingsIcon,
  ExitIcon,
  AlertCircleIcon,
  PackageIcon,
  ClipboardCheckIcon,
  MoneyIcon,
  SearchIcon,
  ReceiptIcon,
  RefreshIcon,
} from '@shopify/polaris-icons';
import { useAuth } from '../context/AuthContext.jsx';

/**
 * Amazon Seller Hub Navigation
 * Designed for Amazon FBM seller workflows with clear hierarchy
 */
export default function Nav() {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, logout, isAdmin } = useAuth();

  // Core workflow - what sellers do every day
  const coreItems = [
    {
      label: 'Dashboard',
      url: '/',
      icon: HomeIcon,
      exactMatch: true,
    },
    {
      label: 'Orders',
      url: '/orders',
      icon: OrderIcon,
      subNavigationItems: [
        { label: 'All Orders', url: '/orders', exactMatch: true },
        { label: 'Pending Shipment', url: '/orders?status=READY_TO_PICK' },
        { label: 'Needs Review', url: '/review' },
        { label: 'Pick Lists', url: '/picklists' },
      ],
    },
    {
      label: 'Inventory',
      url: '/components',
      icon: InventoryIcon,
      subNavigationItems: [
        { label: 'Stock Levels', url: '/components' },
        { label: 'Replenishment', url: '/replenishment' },
        { label: 'Returns', url: '/returns' },
      ],
    },
  ];

  // Catalog management
  const catalogItems = [
    {
      label: 'Products',
      url: '/bundles',
      icon: ProductIcon,
      subNavigationItems: [
        { label: 'BOMs & Bundles', url: '/bundles' },
        { label: 'Listings', url: '/listings' },
        { label: 'BOM Review', url: '/bom-review' },
      ],
    },
    {
      label: 'ASIN Analyzer',
      url: '/analyzer',
      icon: SearchIcon,
    },
  ];

  // Analytics & insights
  const analyticsItems = [
    {
      label: 'Analytics',
      url: '/profit',
      icon: ChartVerticalFilledIcon,
      subNavigationItems: [
        { label: 'Profitability', url: '/profit' },
        { label: 'Activity Log', url: '/audit' },
      ],
    },
  ];

  // Settings & configuration
  const settingsItems = [
    {
      label: 'Amazon Settings',
      url: '/amazon',
      icon: SettingsIcon,
    },
  ];

  const mapNavItems = (items) => {
    return items.map(item => {
      const isSelected = item.exactMatch
        ? location.pathname === item.url
        : location.pathname.startsWith(item.url) ||
          item.subNavigationItems?.some(sub =>
            location.pathname + location.search === sub.url ||
            location.pathname === sub.url
          );

      return {
        ...item,
        selected: isSelected,
        onClick: () => navigate(item.url),
        subNavigationItems: item.subNavigationItems?.map(sub => ({
          ...sub,
          selected: location.pathname + location.search === sub.url ||
                    (sub.exactMatch && location.pathname === sub.url),
          onClick: () => navigate(sub.url),
        })),
      };
    });
  };

  return (
    <Navigation location={location.pathname}>
      {/* Brand Header */}
      <div style={{
        padding: '16px 20px',
        borderBottom: '1px solid rgba(255,255,255,0.2)',
        marginBottom: '8px',
      }}>
        <BlockStack gap="100">
          <Text variant="headingMd" fontWeight="bold">
            <span style={{ color: '#FF9900' }}>Amazon Hub</span>
          </Text>
          <Text variant="bodySm">
            <span style={{ color: 'rgba(255,255,255,0.8)' }}>Seller Command Center</span>
          </Text>
        </BlockStack>
      </div>

      {/* Custom CSS to fix navigation text colors */}
      <style>{`
        .Polaris-Navigation__SectionHeading {
          color: rgba(255, 255, 255, 0.7) !important;
        }
        .Polaris-Navigation__Text {
          color: white !important;
        }
        .Polaris-Navigation__Item:hover .Polaris-Navigation__Text {
          color: white !important;
        }
        .Polaris-Navigation__SecondaryNavigation .Polaris-Navigation__Text {
          color: rgba(255, 255, 255, 0.85) !important;
        }
        .Polaris-Navigation__Item--selected .Polaris-Navigation__Text {
          color: white !important;
        }
        .Polaris-Navigation__Icon svg {
          fill: rgba(255, 255, 255, 0.9) !important;
        }
        .Polaris-Navigation__Item--selected .Polaris-Navigation__Icon svg {
          fill: white !important;
        }
      `}</style>

      {/* Core Workflow */}
      <Navigation.Section
        items={mapNavItems(coreItems)}
      />

      {/* Catalog */}
      <Navigation.Section
        title="Catalog"
        items={mapNavItems(catalogItems)}
        separator
      />

      {/* Analytics */}
      <Navigation.Section
        title="Insights"
        items={mapNavItems(analyticsItems)}
        separator
      />

      {/* Settings */}
      <Navigation.Section
        title="Settings"
        items={mapNavItems(settingsItems)}
        separator
      />

      {/* User Section */}
      <Navigation.Section
        items={[
          {
            label: user?.name || user?.email || 'Account',
            icon: ExitIcon,
            onClick: logout,
            secondaryAction: {
              icon: ExitIcon,
              accessibilityLabel: 'Sign out',
              onClick: logout,
            },
          },
        ]}
        separator
        fill
      />
    </Navigation>
  );
}
