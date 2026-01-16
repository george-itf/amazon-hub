import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  IndexTable,
  Card,
  TextField,
  Button,
  ButtonGroup,
  Badge,
  Tag,
  Popover,
  ActionList,
  Pagination,
  Spinner,
  Text,
  BlockStack,
  InlineStack,
  Checkbox,
  Icon,
  Divider,
  EmptyState,
  Modal,
  FormLayout,
  ChoiceList,
  Tooltip,
  Box,
} from '@shopify/polaris';
import {
  SearchIcon,
  FilterIcon,
  ViewIcon,
  ChevronDownIcon,
  XIcon,
  PlusIcon,
  CheckIcon,
  ExportIcon,
  DeleteIcon,
  EditIcon,
  SortIcon,
} from '@shopify/polaris-icons';

/* Fallback ColumnsIcon — local inline SVG so build doesn't fail when the icon isn't exported
   Keeps the rest of the file unchanged (uses the same name `ColumnsIcon` elsewhere). */
const ColumnsIcon = () => (
  <svg
    width="16"
    height="16"
    viewBox="0 0 16 16"
    xmlns="http://www.w3.org/2000/svg"
    aria-hidden="true"
    focusable="false"
  >
    <rect x="0" y="0" width="4" height="16" rx="0.5" />
    <rect x="6" y="0" width="4" height="16" rx="0.5" />
    <rect x="12" y="0" width="4" height="16" rx="0.5" />
  </svg>
);

/**
 * HubTable - Unified table component for Amazon Hub
 *
 * Implements the Table UX Standard from the audit:
 * - Search + filter chips
 * - Saved views (personal + shared)
 * - Column show/hide & reorder
 * - Selection rail with scope summary
 * - Bulk actions with preview & confirm
 * - URL-driven state (shareable views)
 *
 * This is a controlled component - parent manages all state.
 */
export default function HubTable({
  // Data
  columns = [],
  rows = [],
  resourceName = { singular: 'item', plural: 'items' },
  idAccessor = 'id',

  // Selection
  selectable = false,
  selectedIds = [],
  onSelectionChange,

  // Filtering
  filters = [],
  activeFilters = {},
  onFilterChange,

  // Search
  searchValue = '',
  onSearchChange,
  searchPlaceholder = 'Search...',

  // Saved Views
  savedViews = [],
  currentViewId = null,
  onViewChange,
  onSaveView,
  onDeleteView,

  // Bulk Actions
  bulkActions = [],

  // Sorting
  sortColumn = null,
  sortDirection = 'descending',
  onSort,

  // Pagination
  page = 1,
  pageSize = 50,
  totalCount = 0,
  onPageChange,
  onPageSizeChange,
  pageSizeOptions = [25, 50, 100],

  // Column Management
  onColumnVisibilityChange,
  onColumnReorder,

  // Loading
  loading = false,

  // Footer
  footerContent,

  // Row click
  onRowClick,

  // Empty state
  emptyState = {
    heading: 'No items found',
    description: 'Try adjusting your search or filters.',
  },

  // URL sync
  syncToUrl = false,
}) {
  // Local state for popovers
  const [filtersPopoverActive, setFiltersPopoverActive] = useState(false);
  const [columnsPopoverActive, setColumnsPopoverActive] = useState(false);
  const [viewsPopoverActive, setViewsPopoverActive] = useState(false);
  const [saveViewModalOpen, setSaveViewModalOpen] = useState(false);
  const [newViewName, setNewViewName] = useState('');
  const [newViewIsShared, setNewViewIsShared] = useState(false);

  // Column drag state
  const [draggedColumn, setDraggedColumn] = useState(null);

  // Visible columns (derived from columns prop)
  const visibleColumns = useMemo(() => {
    return columns.filter(col => col.visible !== false);
  }, [columns]);

  // Calculate selection state
  const allRowIds = useMemo(() => {
    return rows.map(row => row[idAccessor]);
  }, [rows, idAccessor]);

  const selectedCount = selectedIds.length;
  const allSelected = selectedCount > 0 && selectedCount === allRowIds.length;
  const someSelected = selectedCount > 0 && selectedCount < allRowIds.length;

  // URL sync effect
  useEffect(() => {
    if (!syncToUrl) return;

    const params = new URLSearchParams(window.location.search);

    // Sync search
    if (searchValue) {
      params.set('q', searchValue);
    } else {
      params.delete('q');
    }

    // Sync filters
    Object.entries(activeFilters).forEach(([key, value]) => {
      if (value && value !== 'all') {
        params.set(`filter_${key}`, value);
      } else {
        params.delete(`filter_${key}`);
      }
    });

    // Sync sort
    if (sortColumn) {
      params.set('sort', sortColumn);
      params.set('dir', sortDirection);
    }

    // Sync page
    if (page > 1) {
      params.set('page', page.toString());
    } else {
      params.delete('page');
    }

    // Sync view
    if (currentViewId) {
      params.set('view', currentViewId);
    } else {
      params.delete('view');
    }

    const newUrl = `${window.location.pathname}${params.toString() ? '?' + params.toString() : ''}`;
    window.history.replaceState({}, '', newUrl);
  }, [syncToUrl, searchValue, activeFilters, sortColumn, sortDirection, page, currentViewId]);

  // Handlers
  const handleSelectAll = useCallback(() => {
    if (onSelectionChange) {
      if (allSelected) {
        onSelectionChange([]);
      } else {
        onSelectionChange(allRowIds);
      }
    }
  }, [allSelected, allRowIds, onSelectionChange]);

  const handleSelectRow = useCallback((rowId) => {
    if (onSelectionChange) {
      const newSelection = selectedIds.includes(rowId)
        ? selectedIds.filter(id => id !== rowId)
        : [...selectedIds, rowId];
      onSelectionChange(newSelection);
    }
  }, [selectedIds, onSelectionChange]);

  const handleClearSelection = useCallback(() => {
    if (onSelectionChange) {
      onSelectionChange([]);
    }
  }, [onSelectionChange]);

  const handleFilterChange = useCallback((filterKey, value) => {
    if (onFilterChange) {
      onFilterChange({
        ...activeFilters,
        [filterKey]: value,
      });
    }
  }, [activeFilters, onFilterChange]);

  const handleClearFilter = useCallback((filterKey) => {
    if (onFilterChange) {
      const newFilters = { ...activeFilters };
      delete newFilters[filterKey];
      onFilterChange(newFilters);
    }
  }, [activeFilters, onFilterChange]);

  const handleClearAllFilters = useCallback(() => {
    if (onFilterChange) {
      onFilterChange({});
    }
    if (onSearchChange) {
      onSearchChange('');
    }
  }, [onFilterChange, onSearchChange]);

  const handleSort = useCallback((columnKey) => {
    if (onSort) {
      const newDirection = sortColumn === columnKey && sortDirection === 'ascending'
        ? 'descending'
        : 'ascending';
      onSort(columnKey, newDirection);
    }
  }, [sortColumn, sortDirection, onSort]);

  const handleSaveView = useCallback(() => {
    if (onSaveView && newViewName.trim()) {
      onSaveView(newViewName.trim(), newViewIsShared);
      setNewViewName('');
      setNewViewIsShared(false);
      setSaveViewModalOpen(false);
    }
  }, [onSaveView, newViewName, newViewIsShared]);

  const handleColumnVisibilityToggle = useCallback((columnKey) => {
    if (onColumnVisibilityChange) {
      const column = columns.find(c => c.key === columnKey);
      onColumnVisibilityChange(columnKey, column?.visible === false);
    }
  }, [columns, onColumnVisibilityChange]);

  const handleColumnDragStart = useCallback((columnKey) => {
    setDraggedColumn(columnKey);
  }, []);

  const handleColumnDragOver = useCallback((e, targetColumnKey) => {
    e.preventDefault();
    if (!draggedColumn || draggedColumn === targetColumnKey) return;
  }, [draggedColumn]);

  const handleColumnDrop = useCallback((targetColumnKey) => {
    if (!draggedColumn || !onColumnReorder) return;

    const columnKeys = columns.map(c => c.key);
    const draggedIndex = columnKeys.indexOf(draggedColumn);
    const targetIndex = columnKeys.indexOf(targetColumnKey);

    if (draggedIndex === -1 || targetIndex === -1) return;

    const newOrder = [...columnKeys];
    newOrder.splice(draggedIndex, 1);
    newOrder.splice(targetIndex, 0, draggedColumn);

    onColumnReorder(newOrder);
    setDraggedColumn(null);
  }, [draggedColumn, columns, onColumnReorder]);

  // Calculate active filter count
  const activeFilterCount = Object.values(activeFilters).filter(v => v && v !== 'all').length;
  const hasActiveFilters = activeFilterCount > 0 || searchValue;

  // Get filter chips for display
  const filterChips = useMemo(() => {
    const chips = [];

    // Search chip
    if (searchValue) {
      chips.push({
        key: 'search',
        label: `Search: "${searchValue}"`,
        onRemove: () => onSearchChange && onSearchChange(''),
      });
    }

    // Filter chips
    Object.entries(activeFilters).forEach(([key, value]) => {
      if (value && value !== 'all') {
        const filter = filters.find(f => f.key === key);
        const option = filter?.options?.find(o => o.value === value);
        chips.push({
          key,
          label: `${filter?.label || key}: ${option?.label || value}`,
          onRemove: () => handleClearFilter(key),
        });
      }
    });

    return chips;
  }, [searchValue, activeFilters, filters, handleClearFilter, onSearchChange]);

  // Current view display
  const currentView = savedViews.find(v => v.id === currentViewId);

  // Build table headings
  const headings = visibleColumns.map(col => ({
    title: col.label,
    id: col.key,
  }));

  // Build table rows
  const rowMarkup = rows.map((row, index) => {
    const rowId = row[idAccessor];
    const isSelected = selectedIds.includes(rowId);

    return (
      <IndexTable.Row
        id={rowId}
        key={rowId}
        selected={isSelected}
        position={index}
        onClick={onRowClick ? () => onRowClick(row) : undefined}
      >
        {visibleColumns.map(col => {
          const value = col.accessor ? col.accessor(row) : row[col.key];
          const rendered = col.render ? col.render(value, row) : value;

          return (
            <IndexTable.Cell key={col.key}>
              {rendered ?? '-'}
            </IndexTable.Cell>
          );
        })}
      </IndexTable.Row>
    );
  });

  // Pagination info
  const totalPages = Math.ceil(totalCount / pageSize);
  const startItem = totalCount > 0 ? (page - 1) * pageSize + 1 : 0;
  const endItem = Math.min(page * pageSize, totalCount);

  // Bulk actions bar component
  const BulkActionsBar = () => {
    if (selectedCount === 0) return null;

    return (
      <div
        className="hub-bulk-actions-bar"
        style={{
          background: 'var(--hub-primary-light)',
          borderRadius: 'var(--hub-radius-md)',
          padding: 'var(--hub-space-sm) var(--hub-space-md)',
          marginBottom: 'var(--hub-space-md)',
          border: '1px solid var(--hub-primary)',
        }}
      >
        <InlineStack align="space-between" blockAlign="center">
          <InlineStack gap="400" blockAlign="center">
            <Text variant="bodyMd" fontWeight="semibold">
              {selectedCount} {selectedCount === 1 ? resourceName.singular : resourceName.plural} selected
            </Text>
            <Button
              variant="plain"
              onClick={handleClearSelection}
              accessibilityLabel="Clear selection"
            >
              Clear
            </Button>
          </InlineStack>

          <InlineStack gap="200">
            {bulkActions.map(action => (
              <Tooltip key={action.id} content={action.tooltip || action.label}>
                <Button
                  icon={action.icon}
                  onClick={() => action.onAction(selectedIds)}
                  disabled={action.disabled}
                  variant={action.primary ? 'primary' : 'secondary'}
                  tone={action.destructive ? 'critical' : undefined}
                  accessibilityLabel={action.label}
                >
                  {action.label}
                </Button>
              </Tooltip>
            ))}
          </InlineStack>
        </InlineStack>
      </div>
    );
  };

  // Filters popover content
  const FiltersPopoverContent = () => (
    <ActionList
      items={filters.map(filter => ({
        content: filter.label,
        suffix: activeFilters[filter.key] && activeFilters[filter.key] !== 'all'
          ? <Badge tone="info">{filter.options?.find(o => o.value === activeFilters[filter.key])?.label || activeFilters[filter.key]}</Badge>
          : null,
        onAction: () => {
          // This would open a sub-popover in a real implementation
          // For now, cycle through options
          const currentValue = activeFilters[filter.key] || 'all';
          const options = [{ value: 'all' }, ...(filter.options || [])];
          const currentIndex = options.findIndex(o => o.value === currentValue);
          const nextIndex = (currentIndex + 1) % options.length;
          handleFilterChange(filter.key, options[nextIndex].value);
        },
      }))}
    />
  );

  // Columns popover content
  const ColumnsPopoverContent = () => (
    <div style={{ padding: '12px', minWidth: '200px' }}>
      <BlockStack gap="200">
        <Text variant="headingSm">Show/Hide Columns</Text>
        <Divider />
        {columns.map(col => (
          <div
            key={col.key}
            draggable={!!onColumnReorder}
            onDragStart={() => handleColumnDragStart(col.key)}
            onDragOver={(e) => handleColumnDragOver(e, col.key)}
            onDrop={() => handleColumnDrop(col.key)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              padding: '4px 0',
              cursor: onColumnReorder ? 'grab' : 'default',
              opacity: draggedColumn === col.key ? 0.5 : 1,
            }}
          >
            <Checkbox
              label={col.label}
              checked={col.visible !== false}
              onChange={() => handleColumnVisibilityToggle(col.key)}
              disabled={col.required}
            />
          </div>
        ))}
      </BlockStack>
    </div>
  );

  // Views popover content
  const ViewsPopoverContent = () => (
    <div style={{ minWidth: '220px' }}>
      <ActionList
        items={[
          // Default "All" view
          {
            content: 'All',
            active: !currentViewId,
            onAction: () => {
              if (onViewChange) onViewChange(null);
              setViewsPopoverActive(false);
            },
          },
          // Divider if there are saved views
          ...(savedViews.length > 0 ? [{ content: '', disabled: true }] : []),
          // Saved views
          ...savedViews.map(view => ({
            content: (
              <InlineStack gap="200" blockAlign="center">
                <span>{view.name}</span>
                {view.isShared && <Badge tone="info" size="small">Shared</Badge>}
              </InlineStack>
            ),
            active: currentViewId === view.id,
            onAction: () => {
              if (onViewChange) onViewChange(view.id);
              setViewsPopoverActive(false);
            },
            suffix: onDeleteView ? (
              <Button
                icon={DeleteIcon}
                variant="plain"
                tone="critical"
                onClick={(e) => {
                  e.stopPropagation();
                  onDeleteView(view.id);
                }}
                accessibilityLabel={`Delete ${view.name} view`}
              />
            ) : null,
          })),
        ]}
      />
      {onSaveView && (
        <>
          <Divider />
          <div style={{ padding: '8px' }}>
            <Button
              fullWidth
              icon={PlusIcon}
              onClick={() => {
                setViewsPopoverActive(false);
                setSaveViewModalOpen(true);
              }}
              disabled={!hasActiveFilters}
            >
              Save current view
            </Button>
          </div>
        </>
      )}
    </div>
  );

  return (
    <Card>
      <BlockStack gap="400">
        {/* Search and Controls Bar */}
        <div style={{ padding: '16px 16px 0 16px' }}>
          <InlineStack gap="300" blockAlign="center" wrap={false}>
            {/* Search */}
            {onSearchChange && (
              <div style={{ flex: 1, maxWidth: '400px' }}>
                <TextField
                  value={searchValue}
                  onChange={onSearchChange}
                  placeholder={searchPlaceholder}
                  autoComplete="off"
                  prefix={<Icon source={SearchIcon} />}
                  clearButton
                  onClearButtonClick={() => onSearchChange('')}
                  label="Search"
                  labelHidden
                />
              </div>
            )}

            {/* Filters Button */}
            {filters.length > 0 && (
              <Popover
                active={filtersPopoverActive}
                activator={
                  <Button
                    icon={FilterIcon}
                    onClick={() => setFiltersPopoverActive(prev => !prev)}
                    disclosure
                    accessibilityLabel="Filters"
                  >
                    Filters
                    {activeFilterCount > 0 && (
                      <Badge tone="info" size="small">{activeFilterCount}</Badge>
                    )}
                  </Button>
                }
                onClose={() => setFiltersPopoverActive(false)}
                preferredAlignment="left"
              >
                <FiltersPopoverContent />
              </Popover>
            )}

            {/* Saved Views Button */}
            {(savedViews.length > 0 || onSaveView) && (
              <Popover
                active={viewsPopoverActive}
                activator={
                  <Button
                    icon={ViewIcon}
                    onClick={() => setViewsPopoverActive(prev => !prev)}
                    disclosure
                    accessibilityLabel="Saved views"
                  >
                    {currentView?.name || 'Views'}
                  </Button>
                }
                onClose={() => setViewsPopoverActive(false)}
                preferredAlignment="left"
              >
                <ViewsPopoverContent />
              </Popover>
            )}

            {/* Column Management Button */}
            {onColumnVisibilityChange && (
              <Popover
                active={columnsPopoverActive}
                activator={
                  <Button
                    icon={ColumnsIcon}
                    onClick={() => setColumnsPopoverActive(prev => !prev)}
                    accessibilityLabel="Column settings"
                  >
                    Columns
                  </Button>
                }
                onClose={() => setColumnsPopoverActive(false)}
                preferredAlignment="right"
              >
                <ColumnsPopoverContent />
              </Popover>
            )}
          </InlineStack>
        </div>

        {/* Filter Chips */}
        {filterChips.length > 0 && (
          <div style={{ padding: '0 16px' }}>
            <InlineStack gap="200" blockAlign="center">
              {filterChips.map(chip => (
                <Tag key={chip.key} onRemove={chip.onRemove}>
                  {chip.label}
                </Tag>
              ))}
              {filterChips.length > 1 && (
                <Button
                  variant="plain"
                  onClick={handleClearAllFilters}
                  accessibilityLabel="Clear all filters"
                >
                  Clear all
                </Button>
              )}
            </InlineStack>
          </div>
        )}

        {/* Bulk Actions Bar */}
        {selectable && <div style={{ padding: '0 16px' }}><BulkActionsBar /></div>}

        {/* Loading State */}
        {loading && rows.length === 0 && (
          <div style={{ display: 'flex', justifyContent: 'center', padding: '60px' }}>
            <Spinner accessibilityLabel="Loading" size="large" />
          </div>
        )}

        {/* Empty State */}
        {!loading && rows.length === 0 && (
          <div style={{ padding: '40px' }}>
            <EmptyState
              heading={emptyState.heading}
              action={emptyState.action}
              image=""
            >
              <p>{emptyState.description}</p>
              {hasActiveFilters && (
                <div style={{ marginTop: '16px' }}>
                  <Button onClick={handleClearAllFilters}>
                    Clear filters
                  </Button>
                </div>
              )}
            </EmptyState>
          </div>
        )}

        {/* Table */}
        {rows.length > 0 && (
          <IndexTable
            resourceName={resourceName}
            itemCount={rows.length}
            headings={headings}
            selectable={selectable}
            selectedItemsCount={selectedCount}
            onSelectionChange={selectable ? (selectionType, toggleType, selection) => {
              if (selectionType === 'all') {
                handleSelectAll();
              } else {
                // IndexTable passes the row ID directly
                handleSelectRow(selection);
              }
            } : undefined}
            sortable={columns.map(c => c.sortable || false)}
            sortDirection={sortDirection}
            sortColumnIndex={visibleColumns.findIndex(c => c.key === sortColumn)}
            onSort={(headingIndex) => {
              const column = visibleColumns[headingIndex];
              if (column?.sortable) {
                handleSort(column.key);
              }
            }}
            loading={loading}
            hasMoreItems={page < totalPages}
          >
            {rowMarkup}
          </IndexTable>
        )}

        {/* Footer with Pagination */}
        {(totalCount > 0 || footerContent) && (
          <div style={{ padding: '16px', borderTop: '1px solid var(--hub-border)' }}>
            <InlineStack align="space-between" blockAlign="center">
              <Text variant="bodySm" tone="subdued">
                {footerContent || `Showing ${startItem}-${endItem} of ${totalCount} ${totalCount === 1 ? resourceName.singular : resourceName.plural}`}
              </Text>

              {totalPages > 1 && onPageChange && (
                <InlineStack gap="300" blockAlign="center">
                  {/* Page size selector */}
                  {onPageSizeChange && (
                    <InlineStack gap="100" blockAlign="center">
                      <Text variant="bodySm" tone="subdued">Show:</Text>
                      <ButtonGroup segmented>
                        {pageSizeOptions.map(size => (
                          <Button
                            key={size}
                            pressed={pageSize === size}
                            onClick={() => onPageSizeChange(size)}
                            size="slim"
                          >
                            {size}
                          </Button>
                        ))}
                      </ButtonGroup>
                    </InlineStack>
                  )}

                  <Pagination
                    hasPrevious={page > 1}
                    hasNext={page < totalPages}
                    onPrevious={() => onPageChange(page - 1)}
                    onNext={() => onPageChange(page + 1)}
                    label={`Page ${page} of ${totalPages}`}
                  />
                </InlineStack>
              )}
            </InlineStack>
          </div>
        )}
      </BlockStack>

      {/* Save View Modal */}
      <Modal
        open={saveViewModalOpen}
        onClose={() => {
          setSaveViewModalOpen(false);
          setNewViewName('');
          setNewViewIsShared(false);
        }}
        title="Save View"
        primaryAction={{
          content: 'Save View',
          onAction: handleSaveView,
          disabled: !newViewName.trim(),
        }}
        secondaryActions={[
          {
            content: 'Cancel',
            onAction: () => {
              setSaveViewModalOpen(false);
              setNewViewName('');
              setNewViewIsShared(false);
            },
          },
        ]}
      >
        <Modal.Section>
          <BlockStack gap="400">
            <Text variant="bodyMd">
              Save your current filters and search as a view for quick access.
            </Text>

            <FormLayout>
              <TextField
                label="View name"
                value={newViewName}
                onChange={setNewViewName}
                placeholder="e.g., Active UK Orders, High Priority"
                autoComplete="off"
                autoFocus
              />

              <ChoiceList
                title="Visibility"
                choices={[
                  { label: 'Personal - Only visible to me', value: 'personal' },
                  { label: 'Shared - Visible to team members', value: 'shared' },
                ]}
                selected={[newViewIsShared ? 'shared' : 'personal']}
                onChange={(selected) => setNewViewIsShared(selected[0] === 'shared')}
              />
            </FormLayout>

            <BlockStack gap="200">
              <Text variant="bodySm" tone="subdued">Current filter configuration:</Text>
              <div
                style={{
                  padding: '12px',
                  backgroundColor: '#F6F6F7',
                  borderRadius: '8px',
                  fontSize: '12px',
                }}
              >
                {filterChips.length > 0 ? (
                  <InlineStack gap="100" wrap>
                    {filterChips.map(chip => (
                      <Tag key={chip.key}>{chip.label}</Tag>
                    ))}
                  </InlineStack>
                ) : (
                  <Text variant="bodySm" tone="subdued">No active filters</Text>
                )}
              </div>
            </BlockStack>
          </BlockStack>
        </Modal.Section>
      </Modal>
    </Card>
  );
}

/**
 * useHubTableState - Hook for managing HubTable state
 *
 * Provides a complete state management solution for HubTable including:
 * - Selection state
 * - Filter state
 * - Search state
 * - Pagination state
 * - Sorting state
 * - URL synchronization
 */
export function useHubTableState({
  initialPageSize = 50,
  initialFilters = {},
  initialSortColumn = null,
  initialSortDirection = 'descending',
  syncToUrl = false,
} = {}) {
  // Initialize from URL if syncToUrl is enabled
  const getInitialState = useCallback(() => {
    if (!syncToUrl || typeof window === 'undefined') {
      return {
        search: '',
        filters: initialFilters,
        page: 1,
        pageSize: initialPageSize,
        sortColumn: initialSortColumn,
        sortDirection: initialSortDirection,
        selectedIds: [],
      };
    }

    const params = new URLSearchParams(window.location.search);

    // Parse filters from URL
    const urlFilters = { ...initialFilters };
    params.forEach((value, key) => {
      if (key.startsWith('filter_')) {
        urlFilters[key.replace('filter_', '')] = value;
      }
    });

    return {
      search: params.get('q') || '',
      filters: urlFilters,
      page: parseInt(params.get('page') || '1', 10),
      pageSize: initialPageSize,
      sortColumn: params.get('sort') || initialSortColumn,
      sortDirection: (params.get('dir') || initialSortDirection),
      selectedIds: [],
    };
  }, [syncToUrl, initialFilters, initialPageSize, initialSortColumn, initialSortDirection]);

  const [state, setState] = useState(getInitialState);

  // Memoized setters
  const setSearch = useCallback((value) => {
    setState(prev => ({ ...prev, search: value, page: 1 }));
  }, []);

  const setFilters = useCallback((filters) => {
    setState(prev => ({ ...prev, filters, page: 1 }));
  }, []);

  const setPage = useCallback((page) => {
    setState(prev => ({ ...prev, page }));
  }, []);

  const setPageSize = useCallback((pageSize) => {
    setState(prev => ({ ...prev, pageSize, page: 1 }));
  }, []);

  const setSort = useCallback((sortColumn, sortDirection) => {
    setState(prev => ({ ...prev, sortColumn, sortDirection }));
  }, []);

  const setSelectedIds = useCallback((selectedIds) => {
    setState(prev => ({ ...prev, selectedIds }));
  }, []);

  const reset = useCallback(() => {
    setState({
      search: '',
      filters: initialFilters,
      page: 1,
      pageSize: initialPageSize,
      sortColumn: initialSortColumn,
      sortDirection: initialSortDirection,
      selectedIds: [],
    });
  }, [initialFilters, initialPageSize, initialSortColumn, initialSortDirection]);

  return {
    // State values
    searchValue: state.search,
    activeFilters: state.filters,
    page: state.page,
    pageSize: state.pageSize,
    sortColumn: state.sortColumn,
    sortDirection: state.sortDirection,
    selectedIds: state.selectedIds,

    // Setters
    setSearch,
    setFilters,
    setPage,
    setPageSize,
    setSort,
    setSelectedIds,
    reset,

    // Computed
    offset: (state.page - 1) * state.pageSize,
  };
}

/**
 * useColumnManagement - Hook for managing column visibility and order
 */
export function useColumnManagement(initialColumns, storageKey = null) {
  const [columns, setColumns] = useState(() => {
    // Try to restore from localStorage
    if (storageKey && typeof window !== 'undefined') {
      try {
        const stored = localStorage.getItem(`hub_columns_${storageKey}`);
        if (stored) {
          const parsed = JSON.parse(stored);
          // Merge stored visibility with initial columns
          return initialColumns.map(col => ({
            ...col,
            visible: parsed.visibility?.[col.key] ?? col.visible ?? true,
          }));
        }
      } catch (e) {
        console.warn('Failed to restore column preferences:', e);
      }
    }
    return initialColumns.map(col => ({ ...col, visible: col.visible ?? true }));
  });

  // Save to localStorage when columns change
  useEffect(() => {
    if (storageKey && typeof window !== 'undefined') {
      const visibility = {};
      columns.forEach(col => {
        visibility[col.key] = col.visible;
      });
      localStorage.setItem(`hub_columns_${storageKey}`, JSON.stringify({
        visibility,
        order: columns.map(c => c.key),
      }));
    }
  }, [columns, storageKey]);

  const setColumnVisibility = useCallback((columnKey, visible) => {
    setColumns(prev => prev.map(col =>
      col.key === columnKey ? { ...col, visible } : col
    ));
  }, []);

  const reorderColumns = useCallback((newOrder) => {
    setColumns(prev => {
      const columnMap = new Map(prev.map(c => [c.key, c]));
      return newOrder.map(key => columnMap.get(key)).filter(Boolean);
    });
  }, []);

  const resetColumns = useCallback(() => {
    setColumns(initialColumns.map(col => ({ ...col, visible: col.visible ?? true })));
  }, [initialColumns]);

  return {
    columns,
    setColumnVisibility,
    reorderColumns,
    resetColumns,
  };
}
