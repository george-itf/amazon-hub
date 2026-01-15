/**
 * Scheduler Service
 * Handles automated sync tasks for Amazon orders, tracking, and catalog
 */
import supabase from './supabase.js';
import spApiClient from './spApi.js';
import royalMailClient from './royalMail.js';
import { recordSystemEvent } from './audit.js';

const SCHEDULES = {
  ORDERS: 'amazon_order_sync',
  TRACKING: 'shipping_tracking_sync',
  CATALOG: 'amazon_catalog_sync',
  FEES: 'amazon_fees_sync',
};

class Scheduler {
  constructor() {
    this.intervals = {};
    this.running = {};
    this.enabled = process.env.ENABLE_AUTO_SYNC === 'true';
  }

  /**
   * Initialize scheduler with default intervals
   */
  async init() {
    if (!this.enabled) {
      console.log('[Scheduler] Auto-sync disabled (set ENABLE_AUTO_SYNC=true to enable)');
      return;
    }

    console.log('[Scheduler] Initializing auto-sync scheduler...');

    // Load settings from database
    const settings = await this.loadSettings();

    // Start scheduled tasks based on settings
    if (settings.order_sync_enabled !== 'false') {
      const interval = parseInt(settings.order_sync_interval_minutes) || 30;
      this.scheduleTask(SCHEDULES.ORDERS, this.syncOrders.bind(this), interval);
    }

    if (settings.tracking_sync_enabled !== 'false') {
      const interval = parseInt(settings.tracking_sync_interval_minutes) || 60;
      this.scheduleTask(SCHEDULES.TRACKING, this.syncTracking.bind(this), interval);
    }

    if (settings.catalog_sync_enabled === 'true') {
      const interval = parseInt(settings.catalog_sync_interval_minutes) || 360; // 6 hours
      this.scheduleTask(SCHEDULES.CATALOG, this.syncCatalog.bind(this), interval);
    }

    console.log('[Scheduler] Auto-sync scheduler initialized');
  }

  /**
   * Load scheduler settings from database
   */
  async loadSettings() {
    try {
      const { data, error } = await supabase
        .from('amazon_settings')
        .select('setting_key, setting_value');

      if (error) throw error;

      const settings = {};
      for (const row of data || []) {
        settings[row.setting_key] = row.setting_value;
      }
      return settings;
    } catch (err) {
      console.error('[Scheduler] Failed to load settings:', err);
      return {};
    }
  }

  /**
   * Schedule a recurring task
   */
  scheduleTask(name, fn, intervalMinutes) {
    if (this.intervals[name]) {
      clearInterval(this.intervals[name]);
    }

    console.log(`[Scheduler] Scheduling ${name} every ${intervalMinutes} minutes`);

    // Run immediately on startup, then schedule
    this.runTask(name, fn);

    this.intervals[name] = setInterval(
      () => this.runTask(name, fn),
      intervalMinutes * 60 * 1000
    );
  }

  /**
   * Run a task with error handling and locking
   */
  async runTask(name, fn) {
    if (this.running[name]) {
      console.log(`[Scheduler] ${name} already running, skipping`);
      return;
    }

    this.running[name] = true;
    const startTime = Date.now();

    try {
      console.log(`[Scheduler] Starting ${name}...`);
      await fn();
      const duration = Date.now() - startTime;
      console.log(`[Scheduler] ${name} completed in ${duration}ms`);
    } catch (err) {
      console.error(`[Scheduler] ${name} failed:`, err);
      await recordSystemEvent({
        eventType: 'SCHEDULER_ERROR',
        description: `${name} failed: ${err.message}`,
        severity: 'ERROR',
        metadata: { task: name, error: err.message },
      });
    } finally {
      this.running[name] = false;
    }
  }

  /**
   * Sync Amazon orders
   */
  async syncOrders() {
    if (!spApiClient.isConfigured()) {
      console.log('[Scheduler] SP-API not configured, skipping order sync');
      return;
    }

    const createdAfter = new Date();
    createdAfter.setDate(createdAfter.getDate() - 7);

    const orders = await spApiClient.getAllOrders({
      createdAfter: createdAfter.toISOString(),
      orderStatuses: ['Unshipped', 'Shipped', 'PartiallyShipped'],
    });

    console.log(`[Scheduler] Found ${orders.length} orders to process`);

    // Process orders (simplified - full logic is in amazon routes)
    let created = 0;
    let updated = 0;

    for (const order of orders) {
      const { data: existing } = await supabase
        .from('orders')
        .select('id, status')
        .eq('external_order_id', order.AmazonOrderId)
        .eq('channel', 'AMAZON')
        .maybeSingle();

      if (!existing) {
        // New order - delegate to full import logic
        // For scheduler, we just note it needs processing
        created++;
      } else {
        // Check for status updates
        const statusMap = {
          'Shipped': 'DISPATCHED',
          'Canceled': 'CANCELLED',
        };
        const newStatus = statusMap[order.OrderStatus];
        if (newStatus && existing.status !== newStatus) {
          await supabase
            .from('orders')
            .update({ status: newStatus, updated_at: new Date().toISOString() })
            .eq('id', existing.id);
          updated++;
        }
      }
    }

    await recordSystemEvent({
      eventType: 'SCHEDULED_ORDER_SYNC',
      description: `Auto-sync: ${orders.length} orders checked, ${created} new, ${updated} updated`,
      metadata: { total: orders.length, created, updated },
    });
  }

  /**
   * Sync tracking from Royal Mail
   */
  async syncTracking() {
    if (!royalMailClient.isConfigured()) {
      console.log('[Scheduler] Royal Mail not configured, skipping tracking sync');
      return;
    }

    const sinceDate = new Date();
    sinceDate.setDate(sinceDate.getDate() - 7);

    const rmOrders = await royalMailClient.getShippedOrders(sinceDate);
    let trackingFound = 0;
    let amazonConfirmed = 0;

    for (const rmOrder of rmOrders.orders || []) {
      const trackingNumber = rmOrder.trackingNumber;
      const channelRef = rmOrder.channelShippingRef;

      if (!trackingNumber) continue;
      trackingFound++;

      // Find matching order
      const { data: order } = await supabase
        .from('orders')
        .select('id, channel, amazon_order_id, external_order_id')
        .or(`external_order_id.eq.${channelRef},amazon_order_id.eq.${channelRef}`)
        .maybeSingle();

      if (!order) continue;

      // Update shipment
      await supabase
        .from('amazon_shipments')
        .upsert({
          order_id: order.id,
          amazon_order_id: order.amazon_order_id || order.external_order_id,
          carrier_code: 'Royal Mail',
          carrier_name: 'Royal Mail',
          tracking_number: trackingNumber,
          ship_date: rmOrder.shippedDate || new Date().toISOString(),
        }, { onConflict: 'order_id' });

      // Update order status
      await supabase
        .from('orders')
        .update({ status: 'DISPATCHED', updated_at: new Date().toISOString() })
        .eq('id', order.id);

      // Confirm on Amazon
      if (spApiClient.isConfigured()) {
        const amazonOrderId = order.amazon_order_id || (order.channel === 'AMAZON' ? order.external_order_id : null);
        if (amazonOrderId) {
          try {
            await spApiClient.confirmShipment(amazonOrderId, {
              carrierCode: 'Royal Mail',
              carrierName: 'Royal Mail',
              trackingNumber,
              shipDate: rmOrder.shippedDate || new Date().toISOString(),
            });
            amazonConfirmed++;
          } catch (err) {
            console.error(`[Scheduler] Failed to confirm ${amazonOrderId} on Amazon:`, err.message);
          }
        }
      }
    }

    await recordSystemEvent({
      eventType: 'SCHEDULED_TRACKING_SYNC',
      description: `Auto-sync: ${trackingFound} tracking numbers found, ${amazonConfirmed} confirmed on Amazon`,
      metadata: { trackingFound, amazonConfirmed },
    });
  }

  /**
   * Sync catalog data for recent ASINs
   */
  async syncCatalog() {
    if (!spApiClient.isConfigured()) {
      console.log('[Scheduler] SP-API not configured, skipping catalog sync');
      return;
    }

    // Get ASINs that haven't been synced in 7 days
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const { data: staleItems } = await supabase
      .from('amazon_catalog')
      .select('asin')
      .lt('last_synced_at', sevenDaysAgo.toISOString())
      .limit(50);

    const asinsToSync = staleItems?.map(i => i.asin) || [];
    let synced = 0;

    for (const asin of asinsToSync) {
      try {
        const catalogData = await spApiClient.getCatalogItem(asin);
        const summary = catalogData.summaries?.[0] || {};
        const attributes = catalogData.attributes || {};
        const images = catalogData.images?.[0]?.images || [];

        await supabase
          .from('amazon_catalog')
          .upsert({
            asin,
            title: summary.itemName || attributes.item_name?.[0]?.value,
            brand: summary.brand || attributes.brand?.[0]?.value,
            main_image_url: images.find(i => i.variant === 'MAIN')?.link,
            raw_data: catalogData,
            last_synced_at: new Date().toISOString(),
          }, { onConflict: 'asin' });

        synced++;
        await new Promise(r => setTimeout(r, 200)); // Rate limiting
      } catch (err) {
        console.error(`[Scheduler] Failed to sync catalog for ${asin}:`, err.message);
      }
    }

    if (synced > 0) {
      await recordSystemEvent({
        eventType: 'SCHEDULED_CATALOG_SYNC',
        description: `Auto-sync: ${synced} catalog items refreshed`,
        metadata: { synced, total: asinsToSync.length },
      });
    }
  }

  /**
   * Stop all scheduled tasks
   */
  stop() {
    for (const [name, interval] of Object.entries(this.intervals)) {
      clearInterval(interval);
      console.log(`[Scheduler] Stopped ${name}`);
    }
    this.intervals = {};
  }

  /**
   * Get status of all scheduled tasks
   */
  getStatus() {
    return {
      enabled: this.enabled,
      tasks: Object.keys(this.intervals).map(name => ({
        name,
        running: this.running[name] || false,
      })),
    };
  }
}

// Export singleton
const scheduler = new Scheduler();
export default scheduler;
