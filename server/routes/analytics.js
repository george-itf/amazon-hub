import express from 'express';
import supabase from '../services/supabase.js';
import { sendSuccess, errors } from '../middleware/correlationId.js';
import { requireStaff } from '../middleware/auth.js';
import {
  getActiveDemandModel,
  predictUnitsPerDayFromMetrics,
} from '../services/keepaDemandModel.js';

const router = express.Router();

// Default fee rate when no specific rate is available
const DEFAULT_AMAZON_FEE_RATE = 0.15;

/**
 * GET /analytics/summary
 * Get comprehensive analytics summary for a date range
 */
router.get('/summary', requireStaff, async (req, res) => {
  const { start_date, end_date } = req.query;

  try {
    // Build date filters
    let dateFilter = '';
    const params = {};

    if (start_date) {
      dateFilter = `AND order_date >= '${start_date}'`;
    }
    if (end_date) {
      dateFilter += ` AND order_date <= '${end_date}'`;
    }

    // Fetch orders with lines for the period
    let query = supabase
      .from('orders')
      .select(`
        id,
        external_order_id,
        status,
        order_date,
        created_at,
        total_price_pence,
        currency,
        customer_email,
        order_lines (
          id,
          title,
          asin,
          sku,
          quantity,
          unit_price_pence,
          bom_id,
          is_resolved,
          boms (
            id,
            bundle_sku,
            description,
            bom_components (
              qty_required,
              components (
                id,
                internal_sku,
                cost_ex_vat_pence
              )
            )
          )
        )
      `)
      .order('order_date', { ascending: false });

    if (start_date) {
      query = query.gte('order_date', start_date);
    }
    if (end_date) {
      query = query.lte('order_date', end_date);
    }

    const { data: orders, error: ordersError } = await query;

    if (ordersError) {
      console.error('Analytics orders error:', ordersError);
      return errors.internal(res, 'Failed to fetch orders for analytics');
    }

    // Calculate comprehensive metrics
    const metrics = calculateMetrics(orders || []);

    sendSuccess(res, metrics);
  } catch (err) {
    console.error('Analytics error:', err);
    return errors.internal(res, 'Failed to generate analytics');
  }
});

/**
 * GET /analytics/products
 * Get product-level profitability analysis
 */
router.get('/products', requireStaff, async (req, res) => {
  const { start_date, end_date, sort_by = 'revenue', limit = 50 } = req.query;

  try {
    let query = supabase
      .from('orders')
      .select(`
        id,
        status,
        order_date,
        order_lines (
          id,
          title,
          asin,
          sku,
          quantity,
          unit_price_pence,
          bom_id,
          boms (
            id,
            bundle_sku,
            description,
            bom_components (
              qty_required,
              components (
                id,
                internal_sku,
                cost_ex_vat_pence
              )
            )
          )
        )
      `);

    if (start_date) {
      query = query.gte('order_date', start_date);
    }
    if (end_date) {
      query = query.lte('order_date', end_date);
    }

    // Exclude cancelled orders from product analysis
    query = query.neq('status', 'CANCELLED');

    const { data: orders, error } = await query;

    if (error) {
      console.error('Product analytics error:', error);
      return errors.internal(res, 'Failed to fetch product data');
    }

    // Aggregate by product
    const productMap = new Map();

    for (const order of orders || []) {
      for (const line of order.order_lines || []) {
        const key = line.bom_id || line.asin || line.sku || line.title || 'Unknown';
        const existing = productMap.get(key) || {
          key,
          title: line.title,
          asin: line.asin,
          sku: line.sku,
          bom_sku: line.boms?.bundle_sku,
          bom_description: line.boms?.description,
          quantity_sold: 0,
          gross_revenue: 0,
          cogs: 0,
          gross_profit: 0,
          order_count: 0,
          orders: new Set(),
        };

        const qty = line.quantity || 1;
        const revenue = (line.unit_price_pence || 0) * qty;

        // Calculate COGS from BOM components
        let lineCogs = 0;
        if (line.boms?.bom_components) {
          for (const bc of line.boms.bom_components) {
            const componentCost = bc.components?.cost_ex_vat_pence || 0;
            lineCogs += (componentCost * bc.qty_required * qty);
          }
        }

        existing.quantity_sold += qty;
        existing.gross_revenue += revenue;
        existing.cogs += lineCogs;
        existing.gross_profit += (revenue - lineCogs);
        existing.orders.add(order.id);

        productMap.set(key, existing);
      }
    }

    // Convert to array and calculate margins
    let products = Array.from(productMap.values()).map((p) => ({
      ...p,
      order_count: p.orders.size,
      orders: undefined, // Remove the Set
      gross_margin_pct: p.gross_revenue > 0
        ? ((p.gross_revenue - p.cogs) / p.gross_revenue * 100).toFixed(1)
        : 0,
      avg_selling_price: p.quantity_sold > 0
        ? Math.round(p.gross_revenue / p.quantity_sold)
        : 0,
      avg_unit_cost: p.quantity_sold > 0
        ? Math.round(p.cogs / p.quantity_sold)
        : 0,
    }));

    // Sort
    if (sort_by === 'revenue') {
      products.sort((a, b) => b.gross_revenue - a.gross_revenue);
    } else if (sort_by === 'quantity') {
      products.sort((a, b) => b.quantity_sold - a.quantity_sold);
    } else if (sort_by === 'profit') {
      products.sort((a, b) => b.gross_profit - a.gross_profit);
    } else if (sort_by === 'margin') {
      products.sort((a, b) => parseFloat(b.gross_margin_pct) - parseFloat(a.gross_margin_pct));
    }

    // Limit results
    products = products.slice(0, parseInt(limit));

    sendSuccess(res, {
      products,
      total_products: productMap.size,
    });
  } catch (err) {
    console.error('Product analytics error:', err);
    return errors.internal(res, 'Failed to generate product analytics');
  }
});

/**
 * GET /analytics/trends
 * Get daily/weekly/monthly trend data
 */
router.get('/trends', requireStaff, async (req, res) => {
  const { start_date, end_date, granularity = 'daily' } = req.query;

  try {
    let query = supabase
      .from('orders')
      .select(`
        id,
        status,
        order_date,
        total_price_pence,
        order_lines (
          quantity,
          unit_price_pence,
          bom_id,
          boms (
            bom_components (
              qty_required,
              components (
                cost_ex_vat_pence
              )
            )
          )
        )
      `)
      .neq('status', 'CANCELLED')
      .order('order_date', { ascending: true });

    if (start_date) {
      query = query.gte('order_date', start_date);
    }
    if (end_date) {
      query = query.lte('order_date', end_date);
    }

    const { data: orders, error } = await query;

    if (error) {
      console.error('Trends error:', error);
      return errors.internal(res, 'Failed to fetch trend data');
    }

    // Aggregate by period
    const trendMap = new Map();

    for (const order of orders || []) {
      let periodKey;
      const orderDate = order.order_date || order.created_at;

      if (!orderDate) continue;

      const date = new Date(orderDate);

      if (granularity === 'daily') {
        periodKey = orderDate.split('T')[0];
      } else if (granularity === 'weekly') {
        // Get ISO week
        const thursday = new Date(date);
        thursday.setDate(date.getDate() + (4 - (date.getDay() || 7)));
        const yearStart = new Date(thursday.getFullYear(), 0, 1);
        const weekNum = Math.ceil((((thursday - yearStart) / 86400000) + 1) / 7);
        periodKey = `${thursday.getFullYear()}-W${String(weekNum).padStart(2, '0')}`;
      } else if (granularity === 'monthly') {
        periodKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
      }

      const existing = trendMap.get(periodKey) || {
        period: periodKey,
        order_count: 0,
        revenue: 0,
        cogs: 0,
        profit: 0,
        units_sold: 0,
      };

      // Calculate COGS for this order
      let orderCogs = 0;
      let orderUnits = 0;
      for (const line of order.order_lines || []) {
        const qty = line.quantity || 1;
        orderUnits += qty;

        if (line.boms?.bom_components) {
          for (const bc of line.boms.bom_components) {
            const componentCost = bc.components?.cost_ex_vat_pence || 0;
            orderCogs += (componentCost * bc.qty_required * qty);
          }
        }
      }

      existing.order_count += 1;
      existing.revenue += order.total_price_pence || 0;
      existing.cogs += orderCogs;
      existing.profit += (order.total_price_pence || 0) - orderCogs;
      existing.units_sold += orderUnits;

      trendMap.set(periodKey, existing);
    }

    // Convert to sorted array
    const trends = Array.from(trendMap.values())
      .sort((a, b) => a.period.localeCompare(b.period))
      .map((t) => ({
        ...t,
        margin_pct: t.revenue > 0 ? ((t.profit / t.revenue) * 100).toFixed(1) : '0',
        avg_order_value: t.order_count > 0 ? Math.round(t.revenue / t.order_count) : 0,
      }));

    sendSuccess(res, { trends, granularity });
  } catch (err) {
    console.error('Trends error:', err);
    return errors.internal(res, 'Failed to generate trend data');
  }
});

/**
 * GET /analytics/customers
 * Get customer analytics
 */
router.get('/customers', requireStaff, async (req, res) => {
  const { start_date, end_date, limit = 20 } = req.query;

  try {
    let query = supabase
      .from('orders')
      .select('id, customer_email, customer_name, total_price_pence, order_date, status')
      .neq('status', 'CANCELLED');

    if (start_date) {
      query = query.gte('order_date', start_date);
    }
    if (end_date) {
      query = query.lte('order_date', end_date);
    }

    const { data: orders, error } = await query;

    if (error) {
      console.error('Customer analytics error:', error);
      return errors.internal(res, 'Failed to fetch customer data');
    }

    // Aggregate by customer
    const customerMap = new Map();

    for (const order of orders || []) {
      const email = order.customer_email || 'Unknown';
      const existing = customerMap.get(email) || {
        email,
        name: order.customer_name,
        order_count: 0,
        total_spent: 0,
        first_order: order.order_date,
        last_order: order.order_date,
      };

      existing.order_count += 1;
      existing.total_spent += order.total_price_pence || 0;

      if (order.order_date < existing.first_order) {
        existing.first_order = order.order_date;
      }
      if (order.order_date > existing.last_order) {
        existing.last_order = order.order_date;
      }

      customerMap.set(email, existing);
    }

    // Calculate metrics
    const allCustomers = Array.from(customerMap.values());
    const totalCustomers = allCustomers.length;
    const repeatCustomers = allCustomers.filter((c) => c.order_count > 1).length;
    const repeatRate = totalCustomers > 0 ? (repeatCustomers / totalCustomers * 100).toFixed(1) : 0;

    // Top customers by spend
    const topCustomers = allCustomers
      .map((c) => ({
        ...c,
        avg_order_value: c.order_count > 0 ? Math.round(c.total_spent / c.order_count) : 0,
      }))
      .sort((a, b) => b.total_spent - a.total_spent)
      .slice(0, parseInt(limit));

    // Average customer value
    const totalRevenue = allCustomers.reduce((sum, c) => sum + c.total_spent, 0);
    const avgCustomerValue = totalCustomers > 0 ? Math.round(totalRevenue / totalCustomers) : 0;

    sendSuccess(res, {
      summary: {
        total_customers: totalCustomers,
        repeat_customers: repeatCustomers,
        repeat_rate_pct: repeatRate,
        avg_customer_value: avgCustomerValue,
        avg_orders_per_customer: totalCustomers > 0
          ? (orders.length / totalCustomers).toFixed(1)
          : 0,
      },
      top_customers: topCustomers,
    });
  } catch (err) {
    console.error('Customer analytics error:', err);
    return errors.internal(res, 'Failed to generate customer analytics');
  }
});

/**
 * GET /analytics/export
 * Export analytics data as CSV
 */
router.get('/export', requireStaff, async (req, res) => {
  const { start_date, end_date, type = 'orders' } = req.query;

  try {
    let query = supabase
      .from('orders')
      .select(`
        id,
        external_order_id,
        status,
        order_date,
        customer_email,
        customer_name,
        total_price_pence,
        currency,
        order_lines (
          title,
          asin,
          sku,
          quantity,
          unit_price_pence
        )
      `)
      .order('order_date', { ascending: false });

    if (start_date) {
      query = query.gte('order_date', start_date);
    }
    if (end_date) {
      query = query.lte('order_date', end_date);
    }

    const { data: orders, error } = await query;

    if (error) {
      console.error('Export error:', error);
      return errors.internal(res, 'Failed to fetch data for export');
    }

    // Generate CSV based on type
    let csv;
    if (type === 'orders') {
      csv = generateOrdersCSV(orders || []);
    } else if (type === 'products') {
      csv = generateProductsCSV(orders || []);
    } else {
      csv = generateOrdersCSV(orders || []);
    }

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="analytics_${type}_${new Date().toISOString().split('T')[0]}.csv"`);
    res.send(csv);
  } catch (err) {
    console.error('Export error:', err);
    return errors.internal(res, 'Failed to export data');
  }
});

// Helper function to calculate comprehensive metrics
function calculateMetrics(orders) {
  const now = new Date();
  const metrics = {
    // Overall totals
    total_orders: orders.length,
    total_revenue: 0,
    total_cogs: 0,
    total_profit: 0,
    avg_order_value: 0,

    // Status breakdown
    orders_by_status: {},
    revenue_by_status: {},

    // Time-based metrics
    orders_today: 0,
    revenue_today: 0,
    orders_this_week: 0,
    revenue_this_week: 0,
    orders_this_month: 0,
    revenue_this_month: 0,

    // Trends (last 7 days)
    daily_trend: {},

    // Product metrics
    total_units_sold: 0,
    unique_products: new Set(),

    // Customer metrics
    unique_customers: new Set(),

    // Performance
    fulfilled_orders: 0,
    cancelled_orders: 0,
    pending_orders: 0,
    fulfillment_rate: 0,
    cancellation_rate: 0,
  };

  // Initialize daily trend for last 7 days
  for (let i = 6; i >= 0; i--) {
    const date = new Date(now);
    date.setDate(date.getDate() - i);
    const key = date.toISOString().split('T')[0];
    metrics.daily_trend[key] = { orders: 0, revenue: 0, profit: 0 };
  }

  // Calculate date boundaries
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const weekStart = new Date(todayStart);
  weekStart.setDate(weekStart.getDate() - weekStart.getDay());
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  for (const order of orders) {
    const orderDate = new Date(order.order_date || order.created_at);
    const revenue = order.total_price_pence || 0;

    // Calculate COGS from order lines
    let orderCogs = 0;
    let orderUnits = 0;

    for (const line of order.order_lines || []) {
      const qty = line.quantity || 1;
      orderUnits += qty;

      // Track unique products
      metrics.unique_products.add(line.bom_id || line.asin || line.sku || line.title);

      // Calculate COGS from BOM
      if (line.boms?.bom_components) {
        for (const bc of line.boms.bom_components) {
          const componentCost = bc.components?.cost_ex_vat_pence || 0;
          orderCogs += (componentCost * bc.qty_required * qty);
        }
      }
    }

    const profit = revenue - orderCogs;

    // Totals
    metrics.total_revenue += revenue;
    metrics.total_cogs += orderCogs;
    metrics.total_profit += profit;
    metrics.total_units_sold += orderUnits;

    // Status breakdown
    metrics.orders_by_status[order.status] = (metrics.orders_by_status[order.status] || 0) + 1;
    metrics.revenue_by_status[order.status] = (metrics.revenue_by_status[order.status] || 0) + revenue;

    // Track customer
    if (order.customer_email) {
      metrics.unique_customers.add(order.customer_email);
    }

    // Status categorization
    if (order.status === 'DISPATCHED' || order.status === 'PICKED') {
      metrics.fulfilled_orders++;
    } else if (order.status === 'CANCELLED') {
      metrics.cancelled_orders++;
    } else {
      metrics.pending_orders++;
    }

    // Time-based metrics
    if (orderDate >= todayStart) {
      metrics.orders_today++;
      metrics.revenue_today += revenue;
    }
    if (orderDate >= weekStart) {
      metrics.orders_this_week++;
      metrics.revenue_this_week += revenue;
    }
    if (orderDate >= monthStart) {
      metrics.orders_this_month++;
      metrics.revenue_this_month += revenue;
    }

    // Daily trend
    const dateKey = (order.order_date || '').split('T')[0];
    if (metrics.daily_trend[dateKey]) {
      metrics.daily_trend[dateKey].orders++;
      metrics.daily_trend[dateKey].revenue += revenue;
      metrics.daily_trend[dateKey].profit += profit;
    }
  }

  // Calculate averages and rates
  metrics.avg_order_value = metrics.total_orders > 0
    ? Math.round(metrics.total_revenue / metrics.total_orders)
    : 0;

  metrics.gross_margin_pct = metrics.total_revenue > 0
    ? ((metrics.total_profit / metrics.total_revenue) * 100).toFixed(1)
    : '0';

  metrics.fulfillment_rate = metrics.total_orders > 0
    ? ((metrics.fulfilled_orders / metrics.total_orders) * 100).toFixed(1)
    : '0';

  metrics.cancellation_rate = metrics.total_orders > 0
    ? ((metrics.cancelled_orders / metrics.total_orders) * 100).toFixed(1)
    : '0';

  // Convert Sets to counts
  metrics.unique_products = metrics.unique_products.size;
  metrics.unique_customers = metrics.unique_customers.size;

  return metrics;
}

// Generate CSV for orders
function generateOrdersCSV(orders) {
  const headers = ['Order ID', 'Date', 'Status', 'Customer', 'Email', 'Revenue', 'Currency', 'Items'];
  const rows = orders.map((o) => [
    o.external_order_id,
    o.order_date,
    o.status,
    o.customer_name || '',
    o.customer_email || '',
    (o.total_price_pence / 100).toFixed(2),
    o.currency || 'GBP',
    o.order_lines?.length || 0,
  ]);

  return [headers, ...rows].map((row) => row.map(escapeCSV).join(',')).join('\n');
}

// Generate CSV for products
function generateProductsCSV(orders) {
  const productMap = new Map();

  for (const order of orders) {
    if (order.status === 'CANCELLED') continue;

    for (const line of order.order_lines || []) {
      const key = line.asin || line.sku || line.title || 'Unknown';
      const existing = productMap.get(key) || {
        identifier: key,
        title: line.title,
        quantity: 0,
        revenue: 0,
      };
      existing.quantity += line.quantity || 1;
      existing.revenue += (line.unit_price_pence || 0) * (line.quantity || 1);
      productMap.set(key, existing);
    }
  }

  const headers = ['Product ID', 'Title', 'Quantity Sold', 'Revenue (GBP)'];
  const rows = Array.from(productMap.values())
    .sort((a, b) => b.revenue - a.revenue)
    .map((p) => [
      p.identifier,
      p.title,
      p.quantity,
      (p.revenue / 100).toFixed(2),
    ]);

  return [headers, ...rows].map((row) => row.map(escapeCSV).join(',')).join('\n');
}

function escapeCSV(value) {
  if (value === null || value === undefined) return '';
  const str = String(value);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

// ============================================================================
// ANALYTICS HUB ENDPOINTS
// ============================================================================

/**
 * GET /analytics/hub/summary
 * High-level KPIs for the Analytics Hub dashboard
 */
router.get('/hub/summary', requireStaff, async (req, res) => {
  const { location = 'Warehouse', days = 30 } = req.query;
  const daysNum = parseInt(days) || 30;

  try {
    const now = new Date();
    const startDate = new Date(now);
    startDate.setDate(startDate.getDate() - daysNum);
    const startDateStr = startDate.toISOString().split('T')[0];

    // Fetch orders for the period
    const { data: orders, error: ordersError } = await supabase
      .from('orders')
      .select(`
        id,
        total_price_pence,
        channel,
        status,
        order_lines (
          id,
          quantity,
          unit_price_pence,
          bom_id,
          listing_memory_id,
          listing_memory (
            id,
            amazon_fee_percent
          ),
          boms (
            bom_components (
              qty_required,
              components (
                cost_ex_vat_pence
              )
            )
          )
        )
      `)
      .gte('order_date', startDateStr)
      .neq('status', 'CANCELLED')
      .in('channel', ['AMAZON', 'SHOPIFY']);

    if (ordersError) throw ordersError;

    // Calculate metrics
    let revenuePence = 0;
    let cogsPence = 0;
    let feesPence = 0;
    let unitsSold = 0;
    let unresolvedLineCount = 0;

    for (const order of orders || []) {
      revenuePence += order.total_price_pence || 0;

      for (const line of order.order_lines || []) {
        const qty = line.quantity || 1;
        unitsSold += qty;
        const lineRevenue = (line.unit_price_pence || 0) * qty;

        // Check if resolved
        if (!line.bom_id) {
          unresolvedLineCount++;
          continue;
        }

        // Calculate COGS
        let lineCogs = 0;
        if (line.boms?.bom_components) {
          for (const bc of line.boms.bom_components) {
            lineCogs += (bc.components?.cost_ex_vat_pence || 0) * bc.qty_required * qty;
          }
        }
        cogsPence += lineCogs;

        // Calculate fees
        const feeRate = line.listing_memory?.amazon_fee_percent
          ? line.listing_memory.amazon_fee_percent / 100
          : DEFAULT_AMAZON_FEE_RATE;
        feesPence += Math.round(lineRevenue * feeRate);
      }
    }

    const estimatedProfitPence = revenuePence - cogsPence - feesPence;
    const avgMarginPercent = revenuePence > 0
      ? ((estimatedProfitPence / revenuePence) * 100).toFixed(1)
      : 0;

    // Dead stock value (components with on_hand > 0 and last_sold_at > 90 days ago or null)
    const deadStockDate = new Date(now);
    deadStockDate.setDate(deadStockDate.getDate() - 90);
    const deadStockDateStr = deadStockDate.toISOString();

    const { data: deadStock } = await supabase
      .from('component_stock')
      .select(`
        on_hand,
        components!inner (
          id,
          cost_ex_vat_pence,
          last_sold_at
        )
      `)
      .eq('location', location)
      .gt('on_hand', 0);

    let deadStockValuePence = 0;
    for (const stock of deadStock || []) {
      const lastSold = stock.components?.last_sold_at;
      if (!lastSold || new Date(lastSold) < deadStockDate) {
        deadStockValuePence += stock.on_hand * (stock.components?.cost_ex_vat_pence || 0);
      }
    }

    // Low stock / stockout risk counts
    const { data: stockData } = await supabase
      .from('component_stock')
      .select('id, on_hand, reserved')
      .eq('location', location);

    let lowStockCount = 0;
    let stockoutSoonCount = 0;
    for (const s of stockData || []) {
      const available = s.on_hand - s.reserved;
      if (available <= 0) {
        stockoutSoonCount++;
      } else if (available <= 5) {
        lowStockCount++;
      }
    }

    sendSuccess(res, {
      revenue_pence: revenuePence,
      estimated_profit_pence: estimatedProfitPence,
      avg_margin_percent: parseFloat(avgMarginPercent),
      orders_count: orders?.length || 0,
      units_sold: unitsSold,
      dead_stock_value_pence: deadStockValuePence,
      low_stock_count: lowStockCount,
      stockout_soon_count: stockoutSoonCount,
      skipped_unresolved_line_count: unresolvedLineCount,
      period_days: daysNum,
    });
  } catch (err) {
    console.error('Analytics hub summary error:', err);
    errors.internal(res, 'Failed to generate analytics summary');
  }
});

/**
 * GET /analytics/hub/dead-stock
 * Components with stock but no recent sales
 */
router.get('/hub/dead-stock', requireStaff, async (req, res) => {
  const { location = 'Warehouse', days = 90, min_value = 0 } = req.query;
  const daysNum = parseInt(days) || 90;
  const minValue = parseInt(min_value) || 0;

  try {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysNum);
    const cutoffDateStr = cutoffDate.toISOString();

    // Query components with stock at the location
    const { data: stockData, error } = await supabase
      .from('component_stock')
      .select(`
        id,
        on_hand,
        reserved,
        location,
        components!inner (
          id,
          internal_sku,
          description,
          cost_ex_vat_pence,
          last_sold_at
        )
      `)
      .eq('location', location)
      .gt('on_hand', 0)
      .order('on_hand', { ascending: false });

    if (error) throw error;

    // Filter for dead stock and calculate values
    const deadStock = [];
    for (const stock of stockData || []) {
      const lastSold = stock.components?.last_sold_at;
      const isDeadStock = !lastSold || new Date(lastSold) < cutoffDate;

      if (!isDeadStock) continue;

      const deadStockValue = stock.on_hand * (stock.components?.cost_ex_vat_pence || 0);

      if (deadStockValue < minValue) continue;

      deadStock.push({
        component_id: stock.components.id,
        internal_sku: stock.components.internal_sku,
        description: stock.components.description,
        location: stock.location,
        on_hand: stock.on_hand,
        reserved: stock.reserved,
        available: stock.on_hand - stock.reserved,
        cost_ex_vat_pence: stock.components.cost_ex_vat_pence,
        dead_stock_value_pence: deadStockValue,
        last_sold_at: lastSold,
        days_since_sold: lastSold
          ? Math.floor((Date.now() - new Date(lastSold).getTime()) / (1000 * 60 * 60 * 24))
          : null,
      });
    }

    // Sort by dead stock value descending
    deadStock.sort((a, b) => b.dead_stock_value_pence - a.dead_stock_value_pence);

    const totalDeadStockValue = deadStock.reduce((sum, d) => sum + d.dead_stock_value_pence, 0);

    sendSuccess(res, {
      dead_stock: deadStock,
      total_count: deadStock.length,
      total_value_pence: totalDeadStockValue,
      threshold_days: daysNum,
    });
  } catch (err) {
    console.error('Dead stock query error:', err);
    errors.internal(res, 'Failed to fetch dead stock data');
  }
});

/**
 * GET /analytics/hub/movers
 * Top gainers and losers (30d vs prior 30d)
 */
router.get('/hub/movers', requireStaff, async (req, res) => {
  const { limit = 10 } = req.query;
  const limitNum = Math.min(parseInt(limit) || 10, 50);

  try {
    const now = new Date();

    // Current period: 0-30 days ago
    const period1End = new Date(now);
    const period1Start = new Date(now);
    period1Start.setDate(period1Start.getDate() - 30);

    // Prior period: 31-60 days ago
    const period2End = new Date(period1Start);
    period2End.setDate(period2End.getDate() - 1);
    const period2Start = new Date(period2End);
    period2Start.setDate(period2Start.getDate() - 29);

    const period1StartStr = period1Start.toISOString().split('T')[0];
    const period1EndStr = period1End.toISOString().split('T')[0];
    const period2StartStr = period2Start.toISOString().split('T')[0];
    const period2EndStr = period2End.toISOString().split('T')[0];

    // Fetch order lines for both periods
    const { data: recentLines, error: recentError } = await supabase
      .from('order_lines')
      .select(`
        asin,
        sku,
        title,
        quantity,
        unit_price_pence,
        orders!inner (
          order_date,
          channel,
          status
        )
      `)
      .eq('orders.channel', 'AMAZON')
      .neq('orders.status', 'CANCELLED')
      .gte('orders.order_date', period1StartStr)
      .lte('orders.order_date', period1EndStr);

    if (recentError) throw recentError;

    const { data: priorLines, error: priorError } = await supabase
      .from('order_lines')
      .select(`
        asin,
        sku,
        title,
        quantity,
        unit_price_pence,
        orders!inner (
          order_date,
          channel,
          status
        )
      `)
      .eq('orders.channel', 'AMAZON')
      .neq('orders.status', 'CANCELLED')
      .gte('orders.order_date', period2StartStr)
      .lte('orders.order_date', period2EndStr);

    if (priorError) throw priorError;

    // Aggregate by ASIN/SKU
    const aggregateLines = (lines) => {
      const map = new Map();
      for (const line of lines || []) {
        const key = line.asin || line.sku || 'unknown';
        const existing = map.get(key) || {
          asin: line.asin,
          sku: line.sku,
          title: line.title,
          units: 0,
          revenue_pence: 0,
        };
        existing.units += line.quantity || 1;
        existing.revenue_pence += (line.unit_price_pence || 0) * (line.quantity || 1);
        if (!existing.title && line.title) existing.title = line.title;
        map.set(key, existing);
      }
      return map;
    };

    const period1Map = aggregateLines(recentLines);
    const period2Map = aggregateLines(priorLines);

    // Compute deltas
    const allKeys = new Set([...period1Map.keys(), ...period2Map.keys()]);
    const movers = [];

    for (const key of allKeys) {
      const p1 = period1Map.get(key);
      const p2 = period2Map.get(key);

      const units0_30 = p1?.units || 0;
      const units31_60 = p2?.units || 0;
      const deltaUnits = units0_30 - units31_60;

      movers.push({
        asin: p1?.asin || p2?.asin,
        sku: p1?.sku || p2?.sku,
        title: p1?.title || p2?.title,
        units_0_30: units0_30,
        units_31_60: units31_60,
        delta_units: deltaUnits,
        delta_percent: units31_60 > 0
          ? ((deltaUnits / units31_60) * 100).toFixed(1)
          : units0_30 > 0 ? 'NEW' : 0,
        revenue_0_30_pence: p1?.revenue_pence || 0,
        avg_price_pence: units0_30 > 0
          ? Math.round((p1?.revenue_pence || 0) / units0_30)
          : 0,
      });
    }

    // Top gainers (positive delta, sorted desc)
    const topGainers = movers
      .filter(m => m.delta_units > 0)
      .sort((a, b) => b.delta_units - a.delta_units)
      .slice(0, limitNum);

    // Top losers (negative delta, sorted asc)
    const topLosers = movers
      .filter(m => m.delta_units < 0)
      .sort((a, b) => a.delta_units - b.delta_units)
      .slice(0, limitNum);

    // New winners (sold in period 1 but not period 2)
    const newWinners = movers
      .filter(m => m.units_0_30 > 0 && m.units_31_60 === 0)
      .sort((a, b) => b.units_0_30 - a.units_0_30)
      .slice(0, limitNum);

    sendSuccess(res, {
      top_gainers: topGainers,
      top_losers: topLosers,
      new_winners: newWinners,
      period_1: { start: period1StartStr, end: period1EndStr },
      period_2: { start: period2StartStr, end: period2EndStr },
    });
  } catch (err) {
    console.error('Movers query error:', err);
    errors.internal(res, 'Failed to fetch movers data');
  }
});

/**
 * GET /analytics/hub/profitability
 * Listing-level profitability analysis
 */
router.get('/hub/profitability', requireStaff, async (req, res) => {
  const { days = 30, min_units = 1 } = req.query;
  const daysNum = parseInt(days) || 30;
  const minUnits = parseInt(min_units) || 1;

  try {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - daysNum);
    const startDateStr = startDate.toISOString().split('T')[0];

    // Fetch order lines with BOM data
    const { data: orderLines, error } = await supabase
      .from('order_lines')
      .select(`
        id,
        asin,
        sku,
        title,
        quantity,
        unit_price_pence,
        bom_id,
        listing_memory_id,
        listing_memory (
          id,
          asin,
          sku,
          amazon_fee_percent
        ),
        boms (
          id,
          bundle_sku,
          bom_components (
            qty_required,
            components (
              cost_ex_vat_pence
            )
          )
        ),
        orders!inner (
          order_date,
          channel,
          status
        )
      `)
      .neq('orders.status', 'CANCELLED')
      .gte('orders.order_date', startDateStr);

    if (error) throw error;

    // Aggregate by listing/asin
    const profitMap = new Map();

    for (const line of orderLines || []) {
      const key = line.listing_memory_id || line.asin || line.sku || 'unknown';
      const qty = line.quantity || 1;
      const revenue = (line.unit_price_pence || 0) * qty;

      const existing = profitMap.get(key) || {
        listing_memory_id: line.listing_memory_id,
        asin: line.asin || line.listing_memory?.asin,
        sku: line.sku || line.listing_memory?.sku,
        title: line.title,
        bom_sku: line.boms?.bundle_sku,
        units_sold: 0,
        revenue_pence: 0,
        cogs_pence: 0,
        fee_pence: 0,
        profit_pence: 0,
        has_bom: false,
        has_fee_rate: false,
        issues: [],
      };

      existing.units_sold += qty;
      existing.revenue_pence += revenue;

      // Calculate COGS
      if (line.boms?.bom_components) {
        existing.has_bom = true;
        let lineCogs = 0;
        for (const bc of line.boms.bom_components) {
          lineCogs += (bc.components?.cost_ex_vat_pence || 0) * bc.qty_required * qty;
        }
        existing.cogs_pence += lineCogs;
      } else {
        if (!existing.issues.includes('BOM_MISSING')) {
          existing.issues.push('BOM_MISSING');
        }
      }

      // Calculate fees
      const feeRate = line.listing_memory?.amazon_fee_percent
        ? line.listing_memory.amazon_fee_percent / 100
        : DEFAULT_AMAZON_FEE_RATE;

      if (line.listing_memory?.amazon_fee_percent) {
        existing.has_fee_rate = true;
      } else {
        if (!existing.issues.includes('FEES_ESTIMATED')) {
          existing.issues.push('FEES_ESTIMATED');
        }
      }

      existing.fee_pence += Math.round(revenue * feeRate);

      profitMap.set(key, existing);
    }

    // Calculate profit and margin for each
    const profitList = [];
    for (const [key, data] of profitMap.entries()) {
      data.profit_pence = data.revenue_pence - data.cogs_pence - data.fee_pence;
      data.margin_percent = data.revenue_pence > 0
        ? ((data.profit_pence / data.revenue_pence) * 100).toFixed(1)
        : 0;
      data.profit_per_unit = data.units_sold > 0
        ? Math.round(data.profit_pence / data.units_sold)
        : 0;

      // Add margin-related issues
      if (parseFloat(data.margin_percent) < 10 && data.units_sold >= minUnits) {
        if (!data.issues.includes('MARGIN_LOW')) {
          data.issues.push('MARGIN_LOW');
        }
      }

      if (data.units_sold >= minUnits) {
        profitList.push(data);
      }
    }

    // Sort into categories
    const bestProfitTotal = [...profitList]
      .sort((a, b) => b.profit_pence - a.profit_pence)
      .slice(0, 10);

    const bestProfitPerUnit = [...profitList]
      .filter(p => p.units_sold >= 3) // Need some volume
      .sort((a, b) => b.profit_per_unit - a.profit_per_unit)
      .slice(0, 10);

    const worstMargin = [...profitList]
      .filter(p => p.units_sold >= 3 && p.has_bom) // Only items with BOM for accurate margin
      .sort((a, b) => parseFloat(a.margin_percent) - parseFloat(b.margin_percent))
      .slice(0, 10);

    const marginLeaks = profitList.filter(p =>
      p.issues.length > 0 && p.units_sold >= minUnits
    ).sort((a, b) => b.revenue_pence - a.revenue_pence).slice(0, 20);

    // Summary stats
    const totalRevenue = profitList.reduce((sum, p) => sum + p.revenue_pence, 0);
    const totalProfit = profitList.reduce((sum, p) => sum + p.profit_pence, 0);
    const avgMargin = totalRevenue > 0
      ? ((totalProfit / totalRevenue) * 100).toFixed(1)
      : 0;

    sendSuccess(res, {
      summary: {
        total_listings: profitList.length,
        total_revenue_pence: totalRevenue,
        total_profit_pence: totalProfit,
        avg_margin_percent: parseFloat(avgMargin),
        listings_with_issues: marginLeaks.length,
      },
      best_profit_total: bestProfitTotal,
      best_profit_per_unit: bestProfitPerUnit,
      worst_margin: worstMargin,
      margin_leaks: marginLeaks,
      period_days: daysNum,
    });
  } catch (err) {
    console.error('Profitability query error:', err);
    errors.internal(res, 'Failed to fetch profitability data');
  }
});

/**
 * GET /analytics/hub/stock-risk
 * Listing-level stock risk (days of cover, stockout prediction)
 */
router.get('/hub/stock-risk', requireStaff, async (req, res) => {
  const { location = 'Warehouse' } = req.query;

  try {
    // Get active demand model
    const demandModel = await getActiveDemandModel();

    // Get listings with BOMs
    const { data: listings, error: listingsError } = await supabase
      .from('listing_memory')
      .select(`
        id,
        asin,
        sku,
        title_fingerprint,
        bom_id,
        boms!inner (
          id,
          bundle_sku,
          is_active,
          bom_components (
            component_id,
            qty_required,
            components (
              id,
              internal_sku,
              description
            )
          )
        )
      `)
      .eq('is_active', true)
      .not('bom_id', 'is', null);

    if (listingsError) throw listingsError;

    // Get all component stock
    const { data: allStock } = await supabase
      .from('component_stock')
      .select('component_id, on_hand, reserved')
      .eq('location', location);

    const stockMap = new Map();
    for (const s of allStock || []) {
      stockMap.set(s.component_id, {
        on_hand: s.on_hand,
        reserved: s.reserved,
        available: s.on_hand - s.reserved,
      });
    }

    // Get 30-day sales data per ASIN
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const thirtyDaysAgoStr = thirtyDaysAgo.toISOString().split('T')[0];

    const { data: salesData } = await supabase
      .from('order_lines')
      .select(`
        asin,
        sku,
        quantity,
        orders!inner (
          order_date,
          channel,
          status
        )
      `)
      .neq('orders.status', 'CANCELLED')
      .gte('orders.order_date', thirtyDaysAgoStr);

    const salesByAsin = new Map();
    for (const line of salesData || []) {
      const key = line.asin || line.sku;
      if (!key) continue;
      const existing = salesByAsin.get(key) || 0;
      salesByAsin.set(key, existing + (line.quantity || 1));
    }

    // Get latest Keepa metrics for ASINs
    const asins = listings.map(l => l.asin).filter(Boolean);
    let keepaMap = new Map();

    if (asins.length > 0) {
      const { data: keepaData } = await supabase
        .from('keepa_metrics_daily')
        .select('asin, sales_rank, offer_count, buybox_price_pence')
        .in('asin', asins)
        .order('date', { ascending: false });

      // Dedupe to latest per ASIN
      for (const row of keepaData || []) {
        if (!keepaMap.has(row.asin)) {
          keepaMap.set(row.asin, row);
        }
      }
    }

    // Calculate stock risk for each listing
    const riskData = [];

    for (const listing of listings) {
      const bomComponents = listing.boms?.bom_components || [];
      if (bomComponents.length === 0) continue;

      // Calculate buildable units (min across components)
      let buildableUnits = Infinity;
      let bottleneckComponent = null;

      for (const bc of bomComponents) {
        const stock = stockMap.get(bc.component_id);
        const available = stock?.available || 0;
        const canBuild = Math.floor(available / bc.qty_required);

        if (canBuild < buildableUnits) {
          buildableUnits = canBuild;
          bottleneckComponent = {
            id: bc.component_id,
            internal_sku: bc.components?.internal_sku,
            description: bc.components?.description,
            available,
            qty_required: bc.qty_required,
          };
        }
      }

      if (buildableUnits === Infinity) buildableUnits = 0;

      // Get velocity (units per day)
      const asinKey = listing.asin || listing.sku;
      const units30d = salesByAsin.get(asinKey) || 0;
      const internalUnitsPerDay = units30d / 30;

      // Get model prediction if available
      let unitsPerDay = internalUnitsPerDay;
      let demandSource = 'INTERNAL';

      if (demandModel && listing.asin) {
        const keepa = keepaMap.get(listing.asin);
        if (keepa?.sales_rank) {
          const w = Math.min(1, units30d / 10);
          const prediction = predictUnitsPerDayFromMetrics({
            salesRank: keepa.sales_rank,
            offerCount: keepa.offer_count,
            buyboxPricePence: keepa.buybox_price_pence,
            model: demandModel,
          });

          if (prediction.units_per_day_pred != null) {
            unitsPerDay = w * internalUnitsPerDay + (1 - w) * prediction.units_per_day_pred;
            demandSource = w > 0.5 ? 'BLENDED' : 'KEEPA_MODEL';
          }
        }
      }

      // Calculate days of cover
      const daysOfCover = unitsPerDay > 0
        ? Math.round(buildableUnits / unitsPerDay)
        : buildableUnits > 0 ? 999 : 0;

      // Determine risk level
      let risk = 'OK';
      if (daysOfCover < 7) risk = 'STOCKOUT_SOON';
      else if (daysOfCover < 14) risk = 'LOW';

      riskData.push({
        listing_memory_id: listing.id,
        asin: listing.asin,
        sku: listing.sku,
        title: listing.title_fingerprint || listing.boms?.bundle_sku,
        bom_sku: listing.boms?.bundle_sku,
        buildable_units: buildableUnits,
        days_of_cover: daysOfCover,
        predicted_units_per_day: parseFloat(unitsPerDay.toFixed(2)),
        demand_source: demandSource,
        units_30d: units30d,
        bottleneck_component: bottleneckComponent,
        risk,
      });
    }

    // Sort by risk (STOCKOUT_SOON first, then LOW, then by days_of_cover)
    const riskOrder = { STOCKOUT_SOON: 0, LOW: 1, OK: 2 };
    riskData.sort((a, b) => {
      const riskDiff = riskOrder[a.risk] - riskOrder[b.risk];
      if (riskDiff !== 0) return riskDiff;
      return a.days_of_cover - b.days_of_cover;
    });

    // Summary counts
    const stockoutSoonCount = riskData.filter(r => r.risk === 'STOCKOUT_SOON').length;
    const lowStockCount = riskData.filter(r => r.risk === 'LOW').length;
    const okCount = riskData.filter(r => r.risk === 'OK').length;

    sendSuccess(res, {
      stock_risk: riskData,
      summary: {
        total_listings: riskData.length,
        stockout_soon_count: stockoutSoonCount,
        low_stock_count: lowStockCount,
        ok_count: okCount,
      },
      has_demand_model: !!demandModel,
    });
  } catch (err) {
    console.error('Stock risk query error:', err);
    errors.internal(res, 'Failed to fetch stock risk data');
  }
});

/**
 * GET /analytics/hub/data-quality
 * Data quality warnings for analytics accuracy
 */
router.get('/hub/data-quality', requireStaff, async (req, res) => {
  const { days = 30 } = req.query;
  const daysNum = parseInt(days) || 30;

  try {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - daysNum);
    const startDateStr = startDate.toISOString().split('T')[0];

    // Count unresolved order lines
    const { count: unresolvedCount } = await supabase
      .from('order_lines')
      .select('id', { count: 'exact', head: true })
      .is('bom_id', null)
      .gte('created_at', startDateStr);

    const { count: totalLinesCount } = await supabase
      .from('order_lines')
      .select('id', { count: 'exact', head: true })
      .gte('created_at', startDateStr);

    const unresolvedPercent = totalLinesCount > 0
      ? ((unresolvedCount / totalLinesCount) * 100).toFixed(1)
      : 0;

    // Count listings missing Keepa metrics
    const { data: activeListings } = await supabase
      .from('listing_memory')
      .select('asin')
      .eq('is_active', true)
      .not('asin', 'is', null);

    const asins = activeListings?.map(l => l.asin) || [];
    let missingKeepaCount = 0;

    if (asins.length > 0) {
      const { data: keepaAsins } = await supabase
        .from('keepa_metrics_daily')
        .select('asin')
        .in('asin', asins);

      const keepaAsinSet = new Set(keepaAsins?.map(k => k.asin) || []);
      missingKeepaCount = asins.filter(a => !keepaAsinSet.has(a)).length;
    }

    // Count listings with no fee data
    const { count: noFeeCount } = await supabase
      .from('listing_memory')
      .select('id', { count: 'exact', head: true })
      .eq('is_active', true)
      .is('amazon_fee_percent', null);

    // Components missing cost
    const { count: noCostCount } = await supabase
      .from('components')
      .select('id', { count: 'exact', head: true })
      .eq('is_active', true)
      .or('cost_ex_vat_pence.is.null,cost_ex_vat_pence.eq.0');

    const warnings = [];

    if (parseFloat(unresolvedPercent) > 5) {
      warnings.push({
        type: 'UNRESOLVED_ORDERS',
        severity: parseFloat(unresolvedPercent) > 20 ? 'HIGH' : 'MEDIUM',
        message: `${unresolvedPercent}% of order lines are unresolved (${unresolvedCount}/${totalLinesCount})`,
        count: unresolvedCount,
        link: '/review',
      });
    }

    if (missingKeepaCount > 0) {
      warnings.push({
        type: 'MISSING_KEEPA',
        severity: missingKeepaCount > 10 ? 'MEDIUM' : 'LOW',
        message: `${missingKeepaCount} active listings missing Keepa metrics`,
        count: missingKeepaCount,
        link: '/listings?filter=no_keepa',
      });
    }

    if (noFeeCount > 0) {
      warnings.push({
        type: 'NO_FEE_DATA',
        severity: 'LOW',
        message: `${noFeeCount} listings using estimated fee rate (${(DEFAULT_AMAZON_FEE_RATE * 100).toFixed(0)}%)`,
        count: noFeeCount,
        link: '/listings',
      });
    }

    if (noCostCount > 0) {
      warnings.push({
        type: 'NO_COMPONENT_COST',
        severity: 'MEDIUM',
        message: `${noCostCount} components missing cost data`,
        count: noCostCount,
        link: '/components?filter=no_cost',
      });
    }

    sendSuccess(res, {
      warnings,
      metrics: {
        unresolved_line_count: unresolvedCount || 0,
        unresolved_percent: parseFloat(unresolvedPercent),
        total_lines: totalLinesCount || 0,
        missing_keepa_count: missingKeepaCount,
        no_fee_count: noFeeCount || 0,
        no_cost_count: noCostCount || 0,
      },
      period_days: daysNum,
    });
  } catch (err) {
    console.error('Data quality check error:', err);
    errors.internal(res, 'Failed to check data quality');
  }
});

export default router;
