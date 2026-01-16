import React, { useEffect, useState, useMemo, useCallback } from 'react';
import { useDebounce } from '../hooks/useDebounce.js';
import {
  Page,
  Layout,
  Card,
  TextField,
  Button,
  FormLayout,
  Spinner,
  Banner,
  Text,
  BlockStack,
  Badge,
  Modal,
  Select,
  InlineStack,
  Divider,
  ProgressBar,
  Tag,
  Icon,
  Box,
  Tooltip,
} from '@shopify/polaris';
import {
  PlusIcon,
  RefreshIcon,
  ImageIcon,
  EditIcon,
  ExternalIcon,
  DeleteIcon,
  ExportIcon,
  ProductIcon,
  SettingsIcon,
} from '@shopify/polaris-icons';
import {
  getListings,
  getBoms,
  createListing,
  updateListing,
  getListingSettings,
  updateListingSettings,
  getShippingOptions,
} from '../utils/api.jsx';
import { useUserPreferences } from '../hooks/useUserPreferences.jsx';
import HubTable, { useHubTableState, useColumnManagement } from '../components/HubTable.jsx';
import { useSavedViews } from '../hooks/useSavedViews.js';
import SavedViewsBar from '../components/SavedViewsBar.jsx';

/**
 * Format price from pence to pounds
 */
function formatPrice(pence) {
  if (pence === null || pence === undefined) return '-';
  return `£${(pence / 100).toFixed(2)}`;
}

/**
 * Generate Amazon product image URL from ASIN
 */
function getAmazonImageUrl(asin, size = 'small') {
  if (!asin) return null;
  const sizeMap = {
    small: 'SL75',
    medium: 'SL160',
    large: 'SL320',
  };
  const sizeCode = sizeMap[size] || 'SL75';
  return `https://images-na.ssl-images-amazon.com/images/P/${asin}.01._${sizeCode}_.jpg`;
}

/**
 * Truncate text with ellipsis
 */
function truncate(str, maxLength) {
  if (!str) return '';
  if (str.length <= maxLength) return str;
  return str.substring(0, maxLength - 3) + '...';
}

/**
 * AmazonListingsPage - Manage all Amazon listings
 *
 * Refactored to use HubTable for:
 * - Unified table pattern with search, filters, bulk actions
 * - Saved views integration
 * - URL sync for shareable filtered views
 * - Selection scope summary
 */
export default function AmazonListingsPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [listings, setListings] = useState([]);
  const [boms, setBoms] = useState([]);
  const [listingSettingsMap, setListingSettingsMap] = useState({});
  const [shippingOptions, setShippingOptions] = useState([]);
  const [successMessage, setSuccessMessage] = useState(null);

  // HubTable state management with URL sync
  const tableState = useHubTableState({
    initialPageSize: 50,
    initialFilters: {},
    initialSortColumn: 'title',
    initialSortDirection: 'ascending',
    syncToUrl: true,
  });

  // Column management with persistence
  const initialColumns = [
    {
      key: 'image',
      label: 'Image',
      visible: true,
      sortable: false,
      render: (_, row) => {
        const imageUrl = getAmazonImageUrl(row.asin);
        return (
          <div style={{ width: 50, height: 50 }}>
            {imageUrl ? (
              <img
                src={imageUrl}
                alt={row.asin || 'Product'}
                style={{
                  width: 50,
                  height: 50,
                  objectFit: 'contain',
                  borderRadius: 4,
                  border: '1px solid #e1e3e5',
                  background: '#fff',
                }}
                onError={(e) => {
                  e.target.style.display = 'none';
                  if (e.target.nextSibling) e.target.nextSibling.style.display = 'flex';
                }}
              />
            ) : null}
            <div
              style={{
                width: 50,
                height: 50,
                background: '#f6f6f7',
                borderRadius: 4,
                display: imageUrl ? 'none' : 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#8c9196',
              }}
            >
              <Icon source={ImageIcon} />
            </div>
          </div>
        );
      },
    },
    {
      key: 'asin',
      label: 'ASIN',
      visible: true,
      sortable: true,
      render: (_, row) => (
        <InlineStack gap="100" blockAlign="center">
          <Text variant="bodyMd" fontWeight="medium">{row.asin || '-'}</Text>
          {row.asin && (
            <Tooltip content="View on Amazon">
              <a
                href={`https://www.amazon.co.uk/dp/${row.asin}`}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                style={{ color: 'var(--hub-primary)' }}
              >
                <Icon source={ExternalIcon} />
              </a>
            </Tooltip>
          )}
        </InlineStack>
      ),
    },
    {
      key: 'sku',
      label: 'SKU',
      visible: true,
      sortable: true,
      accessor: (row) => row.sku,
      render: (val) => <Text variant="bodyMd">{val || '-'}</Text>,
    },
    {
      key: 'title',
      label: 'Title',
      visible: true,
      sortable: true,
      required: true,
      accessor: (row) => row.title_fingerprint || row.sku || row.asin || 'Unknown',
      render: (val) => (
        <Tooltip content={val}>
          <Text variant="bodyMd" fontWeight="semibold" truncate>
            {truncate(val, 50)}
          </Text>
        </Tooltip>
      ),
    },
    {
      key: 'bom',
      label: 'BOM',
      visible: true,
      sortable: false,
      render: (_, row) => {
        if (!row.bom_id) return <Badge tone="warning">Unassigned</Badge>;
        const bom = boms.find(b => b.id === row.bom_id);
        if (!bom) return <Badge tone="default">Unknown</Badge>;
        return <Badge tone="success">{bom.bundle_sku}</Badge>;
      },
    },
    {
      key: 'status',
      label: 'Status',
      visible: true,
      sortable: true,
      accessor: (row) => row.is_active ? 'Active' : 'Inactive',
      render: (val, row) => (
        row.is_active
          ? <Badge tone="success">Active</Badge>
          : <Badge tone="default">Inactive</Badge>
      ),
    },
    {
      key: 'price',
      label: 'Price',
      visible: true,
      sortable: true,
      render: (_, row) => {
        const settings = listingSettingsMap[row.id] || {};
        return (
          <Text variant="bodyMd">
            {settings.price_override_pence
              ? formatPrice(settings.price_override_pence)
              : <span style={{ color: '#9CA3AF' }}>Auto</span>}
          </Text>
        );
      },
    },
    {
      key: 'stock',
      label: 'Stock',
      visible: true,
      sortable: false,
      render: (_, row) => {
        const settings = listingSettingsMap[row.id] || {};
        if (settings.quantity_override != null) {
          return (
            <InlineStack gap="100">
              <Text variant="bodyMd">{settings.quantity_override}</Text>
              <Badge size="small" tone="info">Override</Badge>
            </InlineStack>
          );
        }
        if (settings.quantity_cap != null) {
          return (
            <InlineStack gap="100">
              <Text variant="bodyMd">Cap: {settings.quantity_cap}</Text>
            </InlineStack>
          );
        }
        return <span style={{ color: '#9CA3AF' }}>Auto</span>;
      },
    },
    {
      key: 'velocity',
      label: 'Sales Velocity',
      visible: false,
      sortable: true,
      accessor: (row) => row.sales_velocity || 0,
      render: (val) => (
        <Text variant="bodyMd">{val ? `${val}/day` : '-'}</Text>
      ),
    },
    {
      key: 'updated',
      label: 'Last Updated',
      visible: false,
      sortable: true,
      accessor: (row) => row.updated_at || row.created_at,
      render: (val) => (
        <Text variant="bodySm" tone="subdued">
          {val ? new Date(val).toLocaleDateString() : '-'}
        </Text>
      ),
    },
  ];

  const { columns, setColumnVisibility, reorderColumns, resetColumns } = useColumnManagement(
    initialColumns,
    'listings_columns'
  );

  // Saved views integration
  const savedViewsHook = useSavedViews('listings', {
    onViewChange: (view) => {
      // Apply view's filters to table state
      if (view?.filters) {
        tableState.setFilters(view.filters);
      }
    },
    syncUrl: true,
    autoApplyDefault: true,
  });

  // Listing detail modal
  const [detailModal, setDetailModal] = useState({ open: false, listing: null });
  const [detailForm, setDetailForm] = useState({
    bom_id: '',
    price_override_pence: '',
    quantity_override: '',
    quantity_cap: '',
    min_margin_override: '',
    target_margin_override: '',
    shipping_rule: '',
    tags: [],
  });
  const [savingDetail, setSavingDetail] = useState(false);

  // BOM assignment modal (for bulk)
  const [bomAssignModal, setBomAssignModal] = useState({ open: false, bomId: '' });
  const [assigningBom, setAssigningBom] = useState(false);

  // Bulk settings modal
  const [bulkSettingsModal, setBulkSettingsModal] = useState({ open: false });
  const [bulkSettingsForm, setBulkSettingsForm] = useState({
    price_override_pence: '',
    quantity_cap: '',
    shipping_rule: '',
  });
  const [savingBulkSettings, setSavingBulkSettings] = useState(false);

  // Remove BOM confirmation modal
  const [removeBomModal, setRemoveBomModal] = useState({ open: false });
  const [removingBom, setRemovingBom] = useState(false);

  // Create mapping rule modal
  const [createModal, setCreateModal] = useState(false);
  const [createForm, setCreateForm] = useState({ asin: '', sku: '', title: '', bom_id: '' });
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState(null);

  // Load data
  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [listingData, bomData, shippingData] = await Promise.all([
        getListings(),
        getBoms(),
        getShippingOptions().catch(() => ({ options: [] })),
      ]);
      setListings(listingData.listings || []);
      setBoms(bomData.boms || []);
      setShippingOptions(shippingData.options || []);

      // Load settings for all listings
      if (listingData.listings?.length > 0) {
        try {
          const settingsData = await getListingSettings(listingData.listings.map(l => l.id));
          const settingsMap = {};
          for (const s of settingsData.settings || []) {
            settingsMap[s.listing_memory_id] = s;
          }
          setListingSettingsMap(settingsMap);
        } catch (err) {
          console.warn('Failed to load listing settings:', err);
        }
      }
    } catch (err) {
      console.error(err);
      setError(err.message || 'Failed to load listings');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  // Define filters for HubTable
  const filters = [
    {
      key: 'bomStatus',
      label: 'BOM Status',
      type: 'select',
      options: [
        { label: 'Assigned', value: 'assigned' },
        { label: 'Unassigned', value: 'unassigned' },
        { label: 'Pending Review', value: 'pending' },
      ],
    },
    {
      key: 'status',
      label: 'Status',
      type: 'select',
      options: [
        { label: 'Active', value: 'active' },
        { label: 'Inactive', value: 'inactive' },
        { label: 'Suppressed', value: 'suppressed' },
      ],
    },
    {
      key: 'stockLevel',
      label: 'Stock Level',
      type: 'select',
      options: [
        { label: 'In Stock', value: 'in_stock' },
        { label: 'Low Stock', value: 'low_stock' },
        { label: 'Out of Stock', value: 'out_of_stock' },
      ],
    },
  ];

  // Filter and search listings
  const filteredListings = useMemo(() => {
    let result = listings;

    // Apply filters from tableState
    const activeFilters = tableState.activeFilters;

    // BOM status filter
    if (activeFilters.bomStatus === 'assigned') {
      result = result.filter(l => l.bom_id);
    } else if (activeFilters.bomStatus === 'unassigned') {
      result = result.filter(l => !l.bom_id);
    } else if (activeFilters.bomStatus === 'pending') {
      result = result.filter(l => {
        if (!l.bom_id) return false;
        const bom = boms.find(b => b.id === l.bom_id);
        return bom?.review_status === 'PENDING_REVIEW';
      });
    }

    // Status filter
    if (activeFilters.status === 'active') {
      result = result.filter(l => l.is_active);
    } else if (activeFilters.status === 'inactive') {
      result = result.filter(l => !l.is_active);
    } else if (activeFilters.status === 'suppressed') {
      result = result.filter(l => l.is_suppressed);
    }

    // Stock level filter
    if (activeFilters.stockLevel) {
      result = result.filter(l => {
        const settings = listingSettingsMap[l.id] || {};
        const qty = settings.quantity_override ?? settings.calculated_qty ?? 0;
        if (activeFilters.stockLevel === 'in_stock') return qty > 10;
        if (activeFilters.stockLevel === 'low_stock') return qty > 0 && qty <= 10;
        if (activeFilters.stockLevel === 'out_of_stock') return qty === 0;
        return true;
      });
    }

    // Search filter
    if (tableState.searchValue) {
      const query = tableState.searchValue.toLowerCase();
      result = result.filter(l => {
        const bom = boms.find(b => b.id === l.bom_id);
        return (
          l.asin?.toLowerCase().includes(query) ||
          l.sku?.toLowerCase().includes(query) ||
          l.title_fingerprint?.toLowerCase().includes(query) ||
          bom?.bundle_sku?.toLowerCase().includes(query)
        );
      });
    }

    // Sort
    if (tableState.sortColumn) {
      const col = columns.find(c => c.key === tableState.sortColumn);
      result = [...result].sort((a, b) => {
        let aVal = col?.accessor ? col.accessor(a) : a[tableState.sortColumn];
        let bVal = col?.accessor ? col.accessor(b) : b[tableState.sortColumn];

        if (aVal == null) aVal = '';
        if (bVal == null) bVal = '';

        let comparison = 0;
        if (typeof aVal === 'string') {
          comparison = aVal.localeCompare(bVal);
        } else {
          comparison = aVal - bVal;
        }

        return tableState.sortDirection === 'ascending' ? comparison : -comparison;
      });
    }

    return result;
  }, [listings, boms, listingSettingsMap, tableState.activeFilters, tableState.searchValue, tableState.sortColumn, tableState.sortDirection, columns]);

  // Paginated listings
  const paginatedListings = useMemo(() => {
    const start = (tableState.page - 1) * tableState.pageSize;
    return filteredListings.slice(start, start + tableState.pageSize);
  }, [filteredListings, tableState.page, tableState.pageSize]);

  // Stats
  const stats = useMemo(() => {
    const total = listings.length;
    const withBom = listings.filter(l => l.bom_id).length;
    const active = listings.filter(l => l.is_active).length;
    const withOverrides = Object.values(listingSettingsMap).filter(s =>
      s.price_override_pence || s.quantity_override || s.quantity_cap
    ).length;
    return { total, withBom, active, withOverrides };
  }, [listings, listingSettingsMap]);

  // Selection scope summary for bulk actions bar
  const selectionSummary = useMemo(() => {
    const selectedIds = tableState.selectedIds;
    if (selectedIds.length === 0) return null;

    const selectedListings = listings.filter(l => selectedIds.includes(l.id));
    const withBom = selectedListings.filter(l => l.bom_id).length;
    const withoutBom = selectedListings.filter(l => !l.bom_id).length;

    return `${selectedIds.length} listing${selectedIds.length === 1 ? '' : 's'} selected (${withBom} with BOM, ${withoutBom} without)`;
  }, [tableState.selectedIds, listings]);

  // BOM options for dropdowns
  const bomOptions = useMemo(() => [
    { label: '-- No BOM Assigned --', value: '' },
    ...boms.map(b => ({ label: `${b.bundle_sku} - ${truncate(b.description || '', 40)}`, value: b.id })),
  ], [boms]);

  // Bulk actions
  const bulkActions = [
    {
      id: 'assign-bom',
      label: 'Assign BOM',
      icon: ProductIcon,
      onAction: () => setBomAssignModal({ open: true, bomId: '' }),
      tooltip: 'Assign a BOM to selected listings',
    },
    {
      id: 'edit-settings',
      label: 'Edit Settings',
      icon: SettingsIcon,
      onAction: () => setBulkSettingsModal({ open: true }),
      tooltip: 'Bulk edit settings for selected listings',
    },
    {
      id: 'export',
      label: 'Export',
      icon: ExportIcon,
      onAction: () => handleExportSelected(),
      tooltip: 'Export selected listings to CSV',
    },
    {
      id: 'remove-bom',
      label: 'Remove BOM',
      icon: DeleteIcon,
      destructive: true,
      onAction: () => setRemoveBomModal({ open: true }),
      tooltip: 'Remove BOM assignment from selected listings',
    },
  ];

  // Export selected listings
  function handleExportSelected() {
    const selectedIds = tableState.selectedIds;
    const toExport = listings.filter(l => selectedIds.includes(l.id));

    const headers = ['ASIN', 'SKU', 'Title', 'BOM SKU', 'Status', 'Price Override', 'Qty Override'];
    const rows = toExport.map(l => {
      const bom = boms.find(b => b.id === l.bom_id);
      const settings = listingSettingsMap[l.id] || {};
      return [
        l.asin || '',
        l.sku || '',
        l.title_fingerprint || '',
        bom?.bundle_sku || '',
        l.is_active ? 'Active' : 'Inactive',
        settings.price_override_pence ? formatPrice(settings.price_override_pence) : '',
        settings.quantity_override?.toString() || '',
      ];
    });

    const csv = [headers.join(','), ...rows.map(r => r.map(c => `"${c}"`).join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `listings-export-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);

    setSuccessMessage(`Exported ${toExport.length} listing(s)`);
  }

  // Bulk assign BOM
  async function handleBulkAssignBom() {
    if (!bomAssignModal.bomId) return;

    setAssigningBom(true);
    try {
      const selectedIds = tableState.selectedIds;
      await Promise.all(
        selectedIds.map(id => updateListing(id, { bom_id: bomAssignModal.bomId }))
      );

      // Update local state
      setListings(prev => prev.map(l =>
        selectedIds.includes(l.id) ? { ...l, bom_id: bomAssignModal.bomId } : l
      ));

      setSuccessMessage(`Assigned BOM to ${selectedIds.length} listing(s)`);
      setBomAssignModal({ open: false, bomId: '' });
      tableState.setSelectedIds([]);
    } catch (err) {
      setError(err.message || 'Failed to assign BOM');
    } finally {
      setAssigningBom(false);
    }
  }

  // Bulk remove BOM
  async function handleBulkRemoveBom() {
    setRemovingBom(true);
    try {
      const selectedIds = tableState.selectedIds;
      const listingsWithBom = listings.filter(l => selectedIds.includes(l.id) && l.bom_id);

      await Promise.all(
        listingsWithBom.map(l => updateListing(l.id, { bom_id: null }))
      );

      // Update local state
      setListings(prev => prev.map(l =>
        selectedIds.includes(l.id) ? { ...l, bom_id: null } : l
      ));

      setSuccessMessage(`Removed BOM from ${listingsWithBom.length} listing(s)`);
      setRemoveBomModal({ open: false });
      tableState.setSelectedIds([]);
    } catch (err) {
      setError(err.message || 'Failed to remove BOM');
    } finally {
      setRemovingBom(false);
    }
  }

  // Bulk update settings
  async function handleBulkUpdateSettings() {
    setSavingBulkSettings(true);
    try {
      const selectedIds = tableState.selectedIds;
      const settingsPayload = {};

      if (bulkSettingsForm.price_override_pence) {
        settingsPayload.price_override_pence = Math.round(parseFloat(bulkSettingsForm.price_override_pence) * 100);
      }
      if (bulkSettingsForm.quantity_cap) {
        settingsPayload.quantity_cap = parseInt(bulkSettingsForm.quantity_cap);
      }
      if (bulkSettingsForm.shipping_rule) {
        settingsPayload.shipping_rule = bulkSettingsForm.shipping_rule;
      }

      await Promise.all(
        selectedIds.map(id => updateListingSettings({ listing_memory_id: id, ...settingsPayload }))
      );

      // Update local state
      setListingSettingsMap(prev => {
        const updated = { ...prev };
        selectedIds.forEach(id => {
          updated[id] = { ...updated[id], ...settingsPayload };
        });
        return updated;
      });

      setSuccessMessage(`Updated settings for ${selectedIds.length} listing(s)`);
      setBulkSettingsModal({ open: false });
      setBulkSettingsForm({ price_override_pence: '', quantity_cap: '', shipping_rule: '' });
      tableState.setSelectedIds([]);
    } catch (err) {
      setError(err.message || 'Failed to update settings');
    } finally {
      setSavingBulkSettings(false);
    }
  }

  // Open listing detail modal
  function openDetailModal(listing) {
    const settings = listingSettingsMap[listing.id] || {};
    setDetailForm({
      bom_id: listing.bom_id || '',
      price_override_pence: settings.price_override_pence ? (settings.price_override_pence / 100).toFixed(2) : '',
      quantity_override: settings.quantity_override?.toString() || '',
      quantity_cap: settings.quantity_cap?.toString() || '',
      min_margin_override: settings.min_margin_override?.toString() || '',
      target_margin_override: settings.target_margin_override?.toString() || '',
      shipping_rule: settings.shipping_rule || '',
      tags: settings.tags || [],
    });
    setDetailModal({ open: true, listing });
  }

  // Save listing detail
  async function handleSaveDetail() {
    if (!detailModal.listing) return;
    setSavingDetail(true);
    try {
      const listing = detailModal.listing;

      // Update BOM if changed
      if (detailForm.bom_id !== (listing.bom_id || '')) {
        await updateListing(listing.id, {
          bom_id: detailForm.bom_id || null,
        });
        setListings(prev => prev.map(l =>
          l.id === listing.id ? { ...l, bom_id: detailForm.bom_id || null } : l
        ));
      }

      // Update settings
      const settingsPayload = {
        listing_memory_id: listing.id,
        price_override_pence: detailForm.price_override_pence
          ? Math.round(parseFloat(detailForm.price_override_pence) * 100)
          : null,
        quantity_override: detailForm.quantity_override
          ? parseInt(detailForm.quantity_override)
          : null,
        quantity_cap: detailForm.quantity_cap
          ? parseInt(detailForm.quantity_cap)
          : null,
        min_margin_override: detailForm.min_margin_override
          ? parseFloat(detailForm.min_margin_override)
          : null,
        target_margin_override: detailForm.target_margin_override
          ? parseFloat(detailForm.target_margin_override)
          : null,
        shipping_rule: detailForm.shipping_rule || null,
        tags: detailForm.tags.length > 0 ? detailForm.tags : null,
      };

      const result = await updateListingSettings(settingsPayload);
      setListingSettingsMap(prev => ({
        ...prev,
        [listing.id]: result,
      }));

      setSuccessMessage(`Updated ${listing.title_fingerprint || listing.asin || listing.sku}`);
      setDetailModal({ open: false, listing: null });
    } catch (err) {
      setError(err?.message || 'Failed to save listing');
    } finally {
      setSavingDetail(false);
    }
  }

  // Create mapping rule
  async function handleCreateMapping() {
    setCreating(true);
    setCreateError(null);
    try {
      if (!createForm.asin && !createForm.sku && !createForm.title) {
        setCreateError('Please provide at least one identifier (ASIN, SKU, or Title)');
        setCreating(false);
        return;
      }
      await createListing({
        asin: createForm.asin || null,
        sku: createForm.sku || null,
        title: createForm.title || null,
        bom_id: createForm.bom_id || null,
      });
      setSuccessMessage(`Mapping rule created for ${createForm.asin || createForm.sku || 'title'}`);
      setCreateForm({ asin: '', sku: '', title: '', bom_id: '' });
      setCreateModal(false);
      await load();
    } catch (err) {
      setCreateError(err?.message || 'Failed to create mapping');
    } finally {
      setCreating(false);
    }
  }

  // Handle saved view save
  const handleSaveView = useCallback(async (name, isShared) => {
    try {
      await savedViewsHook.saveView(name, {
        filters: tableState.activeFilters,
        columns: columns.filter(c => c.visible !== false).map(c => c.key),
        sort: {
          column: tableState.sortColumn,
          direction: tableState.sortDirection,
        },
        is_shared: isShared,
      });
      setSuccessMessage(`View "${name}" saved`);
    } catch (err) {
      setError(err.message || 'Failed to save view');
    }
  }, [savedViewsHook, tableState.activeFilters, tableState.sortColumn, tableState.sortDirection, columns]);

  // Get BOM details for modal
  const selectedBom = useMemo(() => {
    if (!detailModal.listing || !detailForm.bom_id) return null;
    return boms.find(b => b.id === detailForm.bom_id);
  }, [detailModal.listing, detailForm.bom_id, boms]);

  return (
    <Page
      title="Amazon Listings"
      subtitle={`${stats.total} listings - ${stats.withBom} with BOM - ${stats.withOverrides} with overrides`}
      primaryAction={{
        content: 'Add Mapping Rule',
        onAction: () => setCreateModal(true),
        icon: PlusIcon,
      }}
      secondaryActions={[
        { content: 'Refresh', onAction: load, icon: RefreshIcon },
      ]}
    >
      <BlockStack gap="400">
        {/* Success/Error Banners */}
        {successMessage && (
          <Banner tone="success" onDismiss={() => setSuccessMessage(null)}>
            <p>{successMessage}</p>
          </Banner>
        )}
        {error && (
          <Banner tone="critical" onDismiss={() => setError(null)}>
            <p>{error}</p>
          </Banner>
        )}

        {/* Stats Cards */}
        <div className="hub-grid hub-grid--4">
          <div className="hub-stat-card">
            <BlockStack gap="200">
              <Text variant="bodySm" tone="subdued">Total Listings</Text>
              <Text variant="headingLg" fontWeight="bold">{stats.total}</Text>
            </BlockStack>
          </div>
          <div className="hub-stat-card hub-stat-card--success">
            <BlockStack gap="200">
              <Text variant="bodySm" tone="subdued">BOM Assigned</Text>
              <Text variant="headingLg" fontWeight="bold" tone="success">{stats.withBom}</Text>
              <ProgressBar progress={stats.total ? (stats.withBom / stats.total) * 100 : 0} tone="success" size="small" />
            </BlockStack>
          </div>
          <div className="hub-stat-card">
            <BlockStack gap="200">
              <Text variant="bodySm" tone="subdued">Active</Text>
              <Text variant="headingLg" fontWeight="bold">{stats.active}</Text>
            </BlockStack>
          </div>
          <div className="hub-stat-card">
            <BlockStack gap="200">
              <Text variant="bodySm" tone="subdued">With Overrides</Text>
              <Text variant="headingLg" fontWeight="bold">{stats.withOverrides}</Text>
            </BlockStack>
          </div>
        </div>

        {/* Saved Views Bar */}
        <SavedViewsBar
          page="listings"
          currentFilters={tableState.activeFilters}
          currentColumns={columns.filter(c => c.visible !== false).map(c => c.key)}
          currentSort={{ column: tableState.sortColumn, direction: tableState.sortDirection }}
          activeViewId={savedViewsHook.activeViewId}
          onApplyView={(view) => {
            if (view?.filters) {
              tableState.setFilters(view.filters);
            } else {
              tableState.setFilters({});
            }
            savedViewsHook.selectView(view?.id || null);
          }}
          onSaveView={() => setSuccessMessage('View saved')}
        />

        {/* HubTable */}
        <HubTable
          columns={columns}
          rows={paginatedListings}
          resourceName={{ singular: 'listing', plural: 'listings' }}
          idAccessor="id"

          // Selection
          selectable={true}
          selectedIds={tableState.selectedIds}
          onSelectionChange={tableState.setSelectedIds}

          // Filtering
          filters={filters}
          activeFilters={tableState.activeFilters}
          onFilterChange={tableState.setFilters}

          // Search
          searchValue={tableState.searchValue}
          onSearchChange={tableState.setSearch}
          searchPlaceholder="Search by ASIN, SKU, title, or BOM..."

          // Saved Views
          savedViews={savedViewsHook.views}
          currentViewId={savedViewsHook.activeViewId}
          onViewChange={(viewId) => savedViewsHook.selectView(viewId)}
          onSaveView={handleSaveView}
          onDeleteView={(viewId) => savedViewsHook.deleteView(viewId)}

          // Bulk Actions
          bulkActions={bulkActions}

          // Sorting
          sortColumn={tableState.sortColumn}
          sortDirection={tableState.sortDirection}
          onSort={(col, dir) => tableState.setSort(col, dir)}

          // Pagination
          page={tableState.page}
          pageSize={tableState.pageSize}
          totalCount={filteredListings.length}
          onPageChange={tableState.setPage}
          onPageSizeChange={tableState.setPageSize}

          // Column Management
          onColumnVisibilityChange={setColumnVisibility}
          onColumnReorder={reorderColumns}

          // Loading
          loading={loading}

          // Row click
          onRowClick={openDetailModal}

          // Empty state
          emptyState={{
            heading: 'No listings found',
            description: 'Try adjusting your search or filters, or add a mapping rule.',
            action: {
              content: 'Add Mapping Rule',
              onAction: () => setCreateModal(true),
            },
          }}

          // URL sync
          syncToUrl={true}

          // Custom footer with selection summary
          footerContent={selectionSummary || undefined}
        />
      </BlockStack>

      {/* Bulk Assign BOM Modal */}
      <Modal
        open={bomAssignModal.open}
        onClose={() => setBomAssignModal({ open: false, bomId: '' })}
        title="Assign BOM to Selected Listings"
        primaryAction={{
          content: 'Assign BOM',
          onAction: handleBulkAssignBom,
          loading: assigningBom,
          disabled: !bomAssignModal.bomId,
        }}
        secondaryActions={[
          { content: 'Cancel', onAction: () => setBomAssignModal({ open: false, bomId: '' }) },
        ]}
      >
        <Modal.Section>
          <BlockStack gap="400">
            <Banner tone="info">
              <p>This will assign the selected BOM to {tableState.selectedIds.length} listing(s).</p>
            </Banner>
            <Select
              label="Select BOM"
              options={bomOptions}
              value={bomAssignModal.bomId}
              onChange={(v) => setBomAssignModal(prev => ({ ...prev, bomId: v }))}
              helpText="Choose the BOM to assign to all selected listings"
            />
          </BlockStack>
        </Modal.Section>
      </Modal>

      {/* Bulk Settings Modal */}
      <Modal
        open={bulkSettingsModal.open}
        onClose={() => setBulkSettingsModal({ open: false })}
        title="Bulk Edit Settings"
        primaryAction={{
          content: 'Apply Settings',
          onAction: handleBulkUpdateSettings,
          loading: savingBulkSettings,
        }}
        secondaryActions={[
          { content: 'Cancel', onAction: () => setBulkSettingsModal({ open: false }) },
        ]}
      >
        <Modal.Section>
          <BlockStack gap="400">
            <Banner tone="info">
              <p>Settings will be applied to {tableState.selectedIds.length} listing(s). Leave fields empty to skip.</p>
            </Banner>
            <FormLayout>
              <TextField
                label="Price Override"
                value={bulkSettingsForm.price_override_pence}
                type="number"
                onChange={(v) => setBulkSettingsForm(f => ({ ...f, price_override_pence: v }))}
                prefix="$"
                step="0.01"
                placeholder="Leave empty to skip"
              />
              <TextField
                label="Quantity Cap"
                value={bulkSettingsForm.quantity_cap}
                type="number"
                onChange={(v) => setBulkSettingsForm(f => ({ ...f, quantity_cap: v }))}
                placeholder="Leave empty to skip"
              />
              <Select
                label="Shipping Rule"
                options={[
                  { label: 'No change', value: '' },
                  { label: 'Default (Standard)', value: 'default' },
                  { label: 'Small Packet', value: 'small_packet' },
                  { label: 'Medium Parcel', value: 'medium_parcel' },
                  { label: 'Large Parcel', value: 'large_parcel' },
                ]}
                value={bulkSettingsForm.shipping_rule}
                onChange={(v) => setBulkSettingsForm(f => ({ ...f, shipping_rule: v }))}
              />
            </FormLayout>
          </BlockStack>
        </Modal.Section>
      </Modal>

      {/* Remove BOM Confirmation Modal */}
      <Modal
        open={removeBomModal.open}
        onClose={() => setRemoveBomModal({ open: false })}
        title="Remove BOM Assignment"
        primaryAction={{
          content: 'Remove BOM',
          onAction: handleBulkRemoveBom,
          loading: removingBom,
          destructive: true,
        }}
        secondaryActions={[
          { content: 'Cancel', onAction: () => setRemoveBomModal({ open: false }) },
        ]}
      >
        <Modal.Section>
          <BlockStack gap="400">
            <Banner tone="warning">
              <p>
                This will remove the BOM assignment from {tableState.selectedIds.length} listing(s).
                Orders for these listings will no longer be automatically resolved.
              </p>
            </Banner>
            <Text variant="bodyMd">Are you sure you want to proceed?</Text>
          </BlockStack>
        </Modal.Section>
      </Modal>

      {/* Create Mapping Rule Modal */}
      <Modal
        open={createModal}
        onClose={() => setCreateModal(false)}
        title="Add Mapping Rule"
        primaryAction={{
          content: 'Create',
          onAction: handleCreateMapping,
          loading: creating,
          disabled: !createForm.bom_id || (!createForm.asin && !createForm.sku && !createForm.title),
        }}
        secondaryActions={[{ content: 'Cancel', onAction: () => setCreateModal(false) }]}
      >
        <Modal.Section>
          <BlockStack gap="400">
            {createError && (
              <Banner tone="critical" onDismiss={() => setCreateError(null)}>
                <p>{createError}</p>
              </Banner>
            )}
            <Banner tone="info">
              <p>Create a mapping rule to link an Amazon ASIN/SKU to a BOM. Orders matching these identifiers will be automatically resolved.</p>
            </Banner>
            <FormLayout>
              <TextField
                label="ASIN"
                value={createForm.asin}
                onChange={(v) => setCreateForm(f => ({ ...f, asin: v }))}
                placeholder="e.g., B08N5WRWNW"
                autoComplete="off"
              />
              <TextField
                label="SKU"
                value={createForm.sku}
                onChange={(v) => setCreateForm(f => ({ ...f, sku: v }))}
                placeholder="e.g., INV-TOOL-001"
                autoComplete="off"
              />
              <TextField
                label="Title"
                value={createForm.title}
                onChange={(v) => setCreateForm(f => ({ ...f, title: v }))}
                placeholder="Product title for fuzzy matching"
                multiline={2}
              />
              <Select
                label="BOM Assignment"
                options={bomOptions}
                value={createForm.bom_id}
                onChange={(v) => setCreateForm(f => ({ ...f, bom_id: v }))}
                helpText="Assign the BOM that defines what components are in this product"
              />
            </FormLayout>
          </BlockStack>
        </Modal.Section>
      </Modal>

      {/* Listing Detail Modal */}
      {detailModal.open && detailModal.listing && (
        <Modal
          open={detailModal.open}
          onClose={() => setDetailModal({ open: false, listing: null })}
          title="Listing Details"
          primaryAction={{
            content: 'Save Changes',
            onAction: handleSaveDetail,
            loading: savingDetail,
          }}
          secondaryActions={[
            { content: 'Cancel', onAction: () => setDetailModal({ open: false, listing: null }) },
            detailModal.listing.asin && {
              content: 'View on Amazon',
              icon: ExternalIcon,
              url: `https://www.amazon.co.uk/dp/${detailModal.listing.asin}`,
              external: true,
            },
          ].filter(Boolean)}
          large
        >
          <Modal.Section>
            <BlockStack gap="600">
              {/* Product Header with Image */}
              <InlineStack gap="400" blockAlign="start">
                <div style={{
                  width: 120,
                  height: 120,
                  background: '#f6f6f7',
                  borderRadius: 8,
                  overflow: 'hidden',
                  flexShrink: 0,
                  border: '1px solid #e1e3e5',
                }}>
                  {detailModal.listing.asin ? (
                    <img
                      src={getAmazonImageUrl(detailModal.listing.asin, 'medium')}
                      alt={detailModal.listing.asin}
                      style={{ width: '100%', height: '100%', objectFit: 'contain' }}
                      onError={(e) => { e.target.style.display = 'none'; }}
                    />
                  ) : (
                    <div style={{
                      width: '100%',
                      height: '100%',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: '#8c9196',
                    }}>
                      <Icon source={ImageIcon} />
                    </div>
                  )}
                </div>
                <BlockStack gap="200">
                  <Text variant="headingMd" fontWeight="bold">
                    {detailModal.listing.title_fingerprint || 'Untitled Product'}
                  </Text>
                  <InlineStack gap="200">
                    {detailModal.listing.asin && (
                      <Badge tone="info">ASIN: {detailModal.listing.asin}</Badge>
                    )}
                    {detailModal.listing.sku && (
                      <Badge>SKU: {detailModal.listing.sku}</Badge>
                    )}
                    {detailModal.listing.is_active ? (
                      <Badge tone="success">Active</Badge>
                    ) : (
                      <Badge tone="default">Inactive</Badge>
                    )}
                  </InlineStack>
                </BlockStack>
              </InlineStack>

              <Divider />

              {/* BOM Assignment */}
              <BlockStack gap="400">
                <Text variant="headingSm">BOM Assignment</Text>
                <Select
                  label="Assigned BOM"
                  options={bomOptions}
                  value={detailForm.bom_id}
                  onChange={(v) => setDetailForm(f => ({ ...f, bom_id: v }))}
                  helpText="Assign the BOM that defines what components are included in this listing"
                />
                {selectedBom && (
                  <Card>
                    <BlockStack gap="200">
                      <InlineStack gap="200" blockAlign="center">
                        <Text variant="bodyMd" fontWeight="semibold">{selectedBom.bundle_sku}</Text>
                        {selectedBom.review_status === 'APPROVED' && <Badge tone="success">Approved</Badge>}
                        {selectedBom.review_status === 'PENDING_REVIEW' && <Badge tone="warning">Pending</Badge>}
                      </InlineStack>
                      {selectedBom.description && (
                        <Text variant="bodySm" tone="subdued">{selectedBom.description}</Text>
                      )}
                    </BlockStack>
                  </Card>
                )}
              </BlockStack>

              <Divider />

              {/* Price & Quantity Overrides */}
              <BlockStack gap="400">
                <Text variant="headingSm">Price & Quantity</Text>
                <FormLayout>
                  <FormLayout.Group>
                    <TextField
                      label="Sell Price Override"
                      value={detailForm.price_override_pence}
                      type="number"
                      onChange={(v) => setDetailForm(f => ({ ...f, price_override_pence: v }))}
                      prefix="$"
                      step="0.01"
                      placeholder="Auto"
                      helpText="Override the automatic price calculation"
                    />
                    <TextField
                      label="Quantity Override"
                      value={detailForm.quantity_override}
                      type="number"
                      onChange={(v) => setDetailForm(f => ({ ...f, quantity_override: v }))}
                      placeholder="Auto"
                      helpText="Override calculated stock quantity"
                    />
                  </FormLayout.Group>
                  <TextField
                    label="Quantity Cap"
                    value={detailForm.quantity_cap}
                    type="number"
                    onChange={(v) => setDetailForm(f => ({ ...f, quantity_cap: v }))}
                    placeholder="No limit"
                    helpText="Maximum quantity to show on Amazon"
                  />
                </FormLayout>
              </BlockStack>

              <Divider />

              {/* Margin Settings */}
              <BlockStack gap="400">
                <Text variant="headingSm">Margin Settings</Text>
                <FormLayout>
                  <FormLayout.Group>
                    <TextField
                      label="Minimum Margin (%)"
                      value={detailForm.min_margin_override}
                      type="number"
                      onChange={(v) => setDetailForm(f => ({ ...f, min_margin_override: v }))}
                      placeholder="10 (default)"
                      suffix="%"
                      helpText="Minimum acceptable margin (default: 10%)"
                    />
                    <TextField
                      label="Target Margin (%)"
                      value={detailForm.target_margin_override}
                      type="number"
                      onChange={(v) => setDetailForm(f => ({ ...f, target_margin_override: v }))}
                      placeholder="15 (default)"
                      suffix="%"
                      helpText="Target margin for pricing"
                    />
                  </FormLayout.Group>
                </FormLayout>
              </BlockStack>

              <Divider />

              {/* Shipping Rule */}
              <BlockStack gap="400">
                <Text variant="headingSm">Shipping</Text>
                <Select
                  label="Shipping Rule"
                  options={[
                    { label: 'Default (Standard)', value: '' },
                    { label: 'Small Packet', value: 'small_packet' },
                    { label: 'Medium Parcel', value: 'medium_parcel' },
                    { label: 'Large Parcel', value: 'large_parcel' },
                    { label: 'Heavy Item', value: 'heavy_item' },
                    ...shippingOptions.map(o => ({ label: o.name, value: o.id })),
                  ]}
                  value={detailForm.shipping_rule}
                  onChange={(v) => setDetailForm(f => ({ ...f, shipping_rule: v }))}
                  helpText="Shipping method for this listing"
                />
              </BlockStack>

              <Divider />

              {/* Tags */}
              <BlockStack gap="400">
                <Text variant="headingSm">Tags</Text>
                <TextField
                  label="Tags"
                  value={detailForm.tags.join(', ')}
                  onChange={(v) => setDetailForm(f => ({
                    ...f,
                    tags: v.split(',').map(t => t.trim()).filter(Boolean)
                  }))}
                  placeholder="tag1, tag2, tag3"
                  helpText="Comma-separated tags for organization and filtering"
                />
                {detailForm.tags.length > 0 && (
                  <InlineStack gap="200">
                    {detailForm.tags.map((tag, i) => (
                      <Tag key={i}>{tag}</Tag>
                    ))}
                  </InlineStack>
                )}
              </BlockStack>
            </BlockStack>
          </Modal.Section>
        </Modal>
      )}
    </Page>
  );
}
