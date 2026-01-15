import React from 'react';
import { Navigation, Text, InlineStack } from '@shopify/polaris';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  HomeIcon,
  OrderIcon,
  ListBulletedIcon,
  InventoryIcon,
  ProductIcon,
  CartIcon,
  QuestionCircleIcon,
  ArrowDownIcon,
  ChartVerticalFilledIcon,
  ExchangeIcon,
  ClockIcon,
  ExitIcon,
  KeyboardIcon,
  SearchIcon,
  CheckIcon,
  StoreMajor,
  DeliveryIcon,
} from '@shopify/polaris-icons';
import { useAuth } from '../context/AuthContext.jsx';

/**
 * Renders the persistent left-hand navigation used throughout the Hub.
 * Items correspond to the top-level pages. The active route is highlighted
 * based on the current URL.
 */
export default function Nav() {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, logout, isAdmin } = useAuth();

  const operationsItems = [
    { label: 'Dashboard', url: '/', icon: HomeIcon },
    { label: 'Orders', url: '/orders', icon: OrderIcon },
    { label: 'Pick Batches', url: '/picklists', icon: ListBulletedIcon },
    { label: 'Review Queue', url: '/review', icon: QuestionCircleIcon },
  ];

  const inventoryItems = [
    { label: 'Components', url: '/components', icon: InventoryIcon },
    { label: 'BOMs / Bundles', url: '/bundles', icon: ProductIcon },
    { label: 'BOM Review', url: '/bom-review', icon: CheckIcon },
    { label: 'Listings', url: '/listings', icon: CartIcon },
    { label: 'Returns', url: '/returns', icon: ExchangeIcon },
  ];

  const analyticsItems = [
    { label: 'ASIN Analyzer', url: '/analyzer', icon: SearchIcon },
    { label: 'Replenishment', url: '/replenishment', icon: ArrowDownIcon },
    { label: 'Profitability', url: '/profit', icon: ChartVerticalFilledIcon },
    { label: 'Audit Log', url: '/audit', icon: ClockIcon },
  ];

  const integrationsItems = [
    { label: 'Amazon', url: '/amazon', icon: StoreMajor },
  ];

  return (
    <Navigation location={location.pathname}>
      <Navigation.Section
        title="Operations"
        items={operationsItems.map(item => ({
          ...item,
          selected: location.pathname === item.url,
          onClick: () => navigate(item.url),
        }))}
      />

      <Navigation.Section
        title="Inventory"
        items={inventoryItems.map(item => ({
          ...item,
          selected: location.pathname === item.url,
          onClick: () => navigate(item.url),
        }))}
        separator
      />

      <Navigation.Section
        title="Analytics"
        items={analyticsItems.map(item => ({
          ...item,
          selected: location.pathname === item.url,
          onClick: () => navigate(item.url),
        }))}
        separator
      />

      <Navigation.Section
        title="Integrations"
        items={integrationsItems.map(item => ({
          ...item,
          selected: location.pathname === item.url,
          onClick: () => navigate(item.url),
        }))}
        separator
      />

      <Navigation.Section
        title="Account"
        items={[
          {
            label: 'Keyboard Shortcuts',
            icon: KeyboardIcon,
            onClick: () => {
              // Trigger keyboard shortcut help via key event
              window.dispatchEvent(new KeyboardEvent('keydown', { key: '?', shiftKey: true }));
            },
            badge: '?',
          },
          {
            label: user?.name || user?.email || 'User',
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
