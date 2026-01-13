import React from 'react';
import { Navigation } from '@shopify/polaris';
import { useLocation, useNavigate } from 'react-router-dom';

/**
 * Renders the persistent left‑hand navigation used throughout the Hub.
 * Items correspond to the top‑level pages defined in the binder.  The
 * active route is highlighted based on the current URL.
 */
export default function Nav() {
  const location = useLocation();
  const navigate = useNavigate();
  const items = [
    { label: 'Dashboard', url: '/' },
    { label: 'Orders', url: '/orders' },
    { label: 'Picklists', url: '/picklists' },
    { label: 'Components', url: '/components' },
    { label: 'Bundles', url: '/bundles' },
    { label: 'Listings', url: '/listings' },
    { label: 'Review', url: '/review' },
    { label: 'Replenishment', url: '/replenishment' },
    { label: 'Profit', url: '/profit' }
  ];
  return (
    <Navigation location={location.pathname} onSelect={({ url }) => navigate(url)}>
      {items.map((item) => (
        <Navigation.Item
          key={item.url}
          label={item.label}
          url={item.url}
          selected={location.pathname === item.url}
        />
      ))}
    </Navigation>
  );
}