import React from 'react';
import { Page, Card } from '@shopify/polaris';

/**
 * Placeholder for the Replenishment planner.  In a complete system
 * this page would analyse component stocks, lead times and order
 * forecasts to suggest purchase orders.  For now it simply informs
 * the user that the feature is not yet implemented.
 */
export default function ReplenishmentPage() {
  return (
    <Page title="Replenishment">
      <Card sectioned>
        <p>This feature will analyse component stock levels, lead times and order forecasts to generate replenishment suggestions.  Implementation pending.</p>
      </Card>
    </Page>
  );
}