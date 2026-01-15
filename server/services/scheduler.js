/**
 * Scheduler Service
 * Handles automated sync tasks for Amazon orders, tracking, and catalog
 */
import supabase from './supabase.js';
import spApiClient from './spApi.js';
import royalMailClient from './royalMail.js';
import { recordSystemEvent } from './audit.js';
import { processAmazonOrder, createResultsTracker } from '../utils/amazonOrderProcessor.js';
import { getDemandModelSettings, trainDemandModelRun } from './keepaDemandModel.js';

const SCHEDULES = {
  ORDERS: 'amazon_order_sync',
  TRACKING: 'shipping_tracking_sync',
  CATALOG: 'amazon_catalog_sync',
  FEES: 'amazon_fees_sync',
  DEMAND_MODEL: 'keepa_demand_model_train',
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

    // Schedule demand model training
    await this.scheduleDemandModelTask();

    console.log('[Scheduler] Auto-sync scheduler initialized');
  }

  /**
   * Schedule demand model training task based on keepa_settings
   */
  async scheduleDemandModelTask() {
    try {
      const settings = await getDemandModelSettings();

      if (!settings.enabled) {
        console.log('[Scheduler] Demand model training disabled');
        return;
      }

      const interval = settings.refreshMinutes || 1440; // Default: daily
      this.scheduleTask(SCHEDULES.DEMAND_MODEL, this.syncDemandModel.bind(this), interval);
    } catch (err) {
      console.error('[Scheduler] Failed to schedule demand model task:', err);
    }
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
   * Sync Amazon orders - fully imports new orders and updates existing ones
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

    // Use the shared order processor for full import
    const results = createResultsTracker();
    results.total = orders.length;

    for (const order of orders) {
      try {
        await processAmazonOrder(order, results);
      } catch (err) {
        console.error(`[Scheduler] Error processing order ${order.AmazonOrderId}:`, err.message);
        results.errors.push({
          orderId: order.AmazonOrderId,
          error: err.message,
        });
      }
    }

    const summary = `Auto-sync: ${results.total} orders - ${results.created} created, ${results.linked} linked, ${results.updated} updated, ${results.skipped} skipped`;
    console.log(`[Scheduler] ${summary}`);

    await recordSystemEvent({
      eventType: 'SCHEDULED_ORDER_SYNC',
      description: summary,
      severity: results.errors.length > 0 ? 'WARN' : 'INFO',
      metadata: {
        total: results.total,
        created: results.created,
        linked: results.linked,
        updated: results.updated,
        skipped: results.skipped,
        errors: results.errors.length,
      },
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
   * Train demand model from Keepa metrics and order history
   */
  async syncDemandModel() {
    try {
      const settings = await getDemandModelSettings();

      if (!settings.enabled) {
        console.log('[Scheduler] Demand model training disabled, skipping');
        return;
      }

      console.log(`[Scheduler] Training demand model: lookback=${settings.lookbackDays}, lambda=${settings.ridgeLambda}`);

      const result = await trainDemandModelRun({
        domainId: settings.domainId,
        lookbackDays: settings.lookbackDays,
        ridgeLambda: settings.ridgeLambda,
        minAsins: settings.minAsins,
      });

      console.log(`[Scheduler] Demand model trained: ${result.training_summary?.rows_total || 0} ASINs`);

      // recordSystemEvent is already called inside trainDemandModelRun
    } catch (err) {
      console.error('[Scheduler] Demand model training failed:', err.message);

      // Record failure event (don't crash scheduler)
      await recordSystemEvent({
        eventType: 'KEEPA_DEMAND_MODEL_TRAINING_FAILED',
        description: `Scheduled training failed: ${err.message}`,
        severity: 'ERROR',
        metadata: { error: err.message },
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
