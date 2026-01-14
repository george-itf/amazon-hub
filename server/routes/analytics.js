import express from 'express';
import supabase from '../services/supabase.js';
import { sendSuccess, errors } from '../middleware/correlationId.js';
import { requireStaff } from '../middleware/auth.js';

const router = express.Router();

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

export default router;
