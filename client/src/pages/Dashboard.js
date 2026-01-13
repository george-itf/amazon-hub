import React, { useEffect, useState } from 'react';
import { Page, Layout, Card, TextContainer, Heading, Spinner } from '@shopify/polaris';
import { getOrders, getComponents, getBoms, getListings, getReviewQueue } from '../utils/api.js';

/**
 * Dashboard summarises high level metrics such as the number of
 * orders, components, bundles, listing memory entries and review
 * items.  It fetches the data from the API on mount.
 */
export default function Dashboard() {
  const [loading, setLoading] = useState(true);
  const [metrics, setMetrics] = useState({ orders: 0, components: 0, boms: 0, listings: 0, review: 0 });
  useEffect(() => {
    async function load() {
      try {
        const [orders, comps, boms, listings, review] = await Promise.all([
          getOrders(),
          getComponents(),
          getBoms(),
          getListings(),
          getReviewQueue()
        ]);
        setMetrics({
          orders: orders.length,
          components: comps.length,
          boms: boms.length,
          listings: listings.length,
          review: review.length
        });
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);
  return (
    <Page title="Dashboard">
      {loading ? (
        <Spinner accessibilityLabel="Loading metrics" size="large" />
      ) : (
        <Layout>
          <Layout.Section oneThird>
            <Card title="Orders" sectioned>
              <Heading>{metrics.orders}</Heading>
              <p>Total orders stored</p>
            </Card>
          </Layout.Section>
          <Layout.Section oneThird>
            <Card title="Components" sectioned>
              <Heading>{metrics.components}</Heading>
              <p>Active components</p>
            </Card>
          </Layout.Section>
          <Layout.Section oneThird>
            <Card title="Bundles" sectioned>
              <Heading>{metrics.boms}</Heading>
              <p>Defined BOMs</p>
            </Card>
          </Layout.Section>
          <Layout.Section oneThird>
            <Card title="Listings" sectioned>
              <Heading>{metrics.listings}</Heading>
              <p>Memory mappings</p>
            </Card>
          </Layout.Section>
          <Layout.Section oneThird>
            <Card title="Review queue" sectioned>
              <Heading>{metrics.review}</Heading>
              <p>Items awaiting resolution</p>
            </Card>
          </Layout.Section>
        </Layout>
      )}
    </Page>
  );
}