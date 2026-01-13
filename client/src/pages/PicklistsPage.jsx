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
      setPicklist(data.pick_batches || []);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    loadPicklist();
  }, []);
  const rows = picklist.map((batch) => [
    batch.batch_number || batch.id?.substring(0, 8),
    batch.status,
    batch.pick_batch_lines?.length || 0
  ]);
  return (
    <Page title="Picklists" primaryAction={{ content: 'Refresh', onAction: loadPicklist }}>
      <Card>
        {loading ? (
          <Spinner accessibilityLabel="Loading picklist" size="large" />
        ) : (
          <DataTable
            columnContentTypes={['text', 'text', 'numeric']}
            headings={['Batch #', 'Status', 'Lines']}
            rows={rows}
          />
        )}
      </Card>
    </Page>
  );
}