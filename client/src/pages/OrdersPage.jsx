import React, { useEffect, useState } from 'react';
import { Page, Card, Button, DataTable, Spinner } from '@shopify/polaris';
import { importOrders, getOrders } from '../utils/api.jsx';

/**
 * OrdersPage lists all orders stored in the system and provides a
 * button to import new open/unfulfilled orders from Shopify.  Each
 * order displays its external ID and the number of lines recorded.
 */
export default function OrdersPage() {
  const [loading, setLoading] = useState(true);
  const [orders, setOrders] = useState([]);
  const [importing, setImporting] = useState(false);
  async function loadOrders() {
    setLoading(true);
    try {
      const data = await getOrders();
      setOrders(data.orders || []);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    loadOrders();
  }, []);
  async function handleImport() {
    setImporting(true);
    try {
      await importOrders();
      await loadOrders();
    } catch (err) {
      alert(`Import failed: ${err.message}`);
    } finally {
      setImporting(false);
    }
  }
  const rows = orders.map((o) => [o.external_order_id, o.order_lines?.length ?? 0]);
  return (
    <Page title="Orders" primaryAction={{ content: 'Import from Shopify', loading: importing, onAction: handleImport }}>
      <Card>
        {loading ? (
          <Spinner accessibilityLabel="Loading orders" size="large" />
        ) : (
          <DataTable
            columnContentTypes={['text', 'numeric']}
            headings={['Order ID', 'Line count']}
            rows={rows}
          />
        )}
      </Card>
    </Page>
  );
}