import React from 'react';
import { Page, Card } from '@shopify/polaris';

/**
 * Placeholder for the Profit analysis page.  A full implementation
 * would calculate margins by listing, include Amazon fees, costs and
 * reconcile them with real orders.  Profit data is deliberately
 * separate from picking logic, per the binder’s rules.  For now
 * this page simply states that the feature is not implemented.
 */
export default function ProfitPage() {
  return (
    <Page title="Profit">
      <Card sectioned>
        <p>Profit analysis will be implemented in a future phase.  It will compute margins and fee drift without affecting operational logic.</p>
      </Card>
    </Page>
  );
}