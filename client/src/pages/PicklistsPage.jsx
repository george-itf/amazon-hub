import React, { useEffect, useState } from 'react';
import { Page, Card, DataTable, Spinner, Button } from '@shopify/polaris';
import { getPickBatches } from '../utils/api.jsx';

/**
 * PicklistsPage displays the aggregated picklist generated from all
 * order lines.  Each row corresponds to a component and shows the
 * total quantity required.  The list is refreshed on mount and can be
 * manually refreshed via a button.
 */
export default function PicklistsPage() {
  const [loading, setLoading] = useState(true);
  const [picklist, setPicklist] = useState([]);
  async function loadPicklist() {
    setLoading(true);
    try {
      const data = await getPickBatches();
      setPicklist(data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    loadPicklist();
  }, []);
  const rows = picklist.map((item) => [item.internal_sku, item.description, item.quantity_required]);
  return (
    <Page title="Picklists" primaryAction={{ content: 'Refresh', onAction: loadPicklist }}>
      <Card>
        {loading ? (
          <Spinner accessibilityLabel="Loading picklist" size="large" />
        ) : (
          <DataTable
            columnContentTypes={['text', 'text', 'numeric']}
            headings={['SKU', 'Description', 'Quantity']}
            rows={rows}
          />
        )}
      </Card>
    </Page>
  );
}