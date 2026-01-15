import React from 'react';
import { Page } from '@shopify/polaris';
import SystemHealthPanel from '../components/SystemHealthPanel.jsx';

/**
 * SettingsPage - System settings and health monitoring
 * Displays integration health status for Amazon, Keepa, Royal Mail, etc.
 */
export default function SettingsPage() {
  return (
    <Page
      title="System Health"
      subtitle="Monitor integration status and sync history"
    >
      <SystemHealthPanel />
    </Page>
  );
}
