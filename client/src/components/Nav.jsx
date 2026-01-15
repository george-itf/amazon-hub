import React from 'react';
import { Navigation, Text, BlockStack } from '@shopify/polaris';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  HomeIcon,
  InventoryIcon,
  ProductIcon,
  SearchIcon,
  DeliveryIcon,
  ChartVerticalFilledIcon,
  SettingsIcon,
  ExitIcon,
} from '@shopify/polaris-icons';
import { useAuth } from '../context/AuthContext.jsx';

/**
 * Amazon Hub Brain Navigation
 *
 * Clean 7-page architecture:
 * 1. Dashboard - Overview, orders, pipeline, quick actions
 * 2. Inventory - Component stock with custom tabs by brand/type
 * 3. Amazon Listings - All Amazon listings with tabs, filters, BOM assignment
 * 4. ASIN Analyzer - Analyze ASINs with scoring
 * 5. Shipping - Royal Mail integration, parcels, tracking
 * 6. Analytics - Profitability, charts, trends
 * 7. Settings - System configuration
 */
export default function Nav() {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, logout } = useAuth();

  // Main navigation items - clean 7-page structure
  const mainItems = [
    {
      label: 'Dashboard',
      url: '/',
      icon: HomeIcon,
      exactMatch: true,
    },
    {
      label: 'Inventory',
      url: '/inventory',
      icon: InventoryIcon,
    },
    {
      label: 'Amazon Listings',
      url: '/listings',
      icon: ProductIcon,
    },
    {
      label: 'ASIN Analyzer',
      url: '/analyzer',
      icon: SearchIcon,
    },
    {
      label: 'Shipping',
      url: '/shipping',
      icon: DeliveryIcon,
    },
    {
      label: 'Analytics',
      url: '/analytics',
      icon: ChartVerticalFilledIcon,
    },
    {
      label: 'Settings',
      url: '/settings',
      icon: SettingsIcon,
    },
  ];

  const mapNavItems = (items) => {
    return items.map(item => {
      const isSelected = item.exactMatch
        ? location.pathname === item.url
        : location.pathname.startsWith(item.url);

      return {
        ...item,
        selected: isSelected,
        onClick: () => navigate(item.url),
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
            <span style={{ color: 'rgba(255,255,255,0.8)' }}>Invicta Tools & Fixings</span>
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

      {/* Main Navigation */}
      <Navigation.Section
        items={mapNavItems(mainItems)}
      />

      {/* User Section */}
      <Navigation.Section
        items={[
          {
            label: user?.name || user?.email || 'Account',
            icon: ExitIcon,
            onClick: logout,
          },
        ]}
        separator
        fill
      />
    </Navigation>
  );
}
