import React, { useState, useMemo } from 'react';
import {
  IndexTable,
  Card,
  TextField,
  Select,
  Pagination,
  BlockStack,
  InlineStack,
  Text,
  EmptyState,
  Spinner,
  Filters,
} from '@shopify/polaris';

/**
 * InvictaTable - Sortable, filterable, paginated data table
 *
 * Props:
 * - columns: Array<{ id, header, accessor, sortable, render }>
 * - data: Array - Row data
 * - loading: boolean
 * - emptyState: { heading, description, action }
 * - selectable: boolean
 * - selectedItems: Array
 * - onSelectionChange: function
 * - pagination: { page, totalPages, onPageChange }
 * - searchable: boolean
 * - searchPlaceholder: string
 * - filters: Array<{ key, label, options }>
 * - onRowClick: function(row)
 */
export function InvictaTable({
  columns = [],
  data = [],
  loading = false,
  emptyState,
  selectable = false,
  selectedItems = [],
  onSelectionChange,
  pagination,
  searchable = false,
  searchPlaceholder = 'Search...',
  filters = [],
  appliedFilters = [],
  onFiltersChange,
  onSearchChange,
  searchValue = '',
  onRowClick,
  resourceName = { singular: 'item', plural: 'items' },
}) {
  const [sortColumn, setSortColumn] = useState(null);
  const [sortDirection, setSortDirection] = useState('descending');

  // Handle sorting
  const handleSort = (headingIndex) => {
    const column = columns[headingIndex];
    if (!column?.sortable) return;

    if (sortColumn === column.id) {
      setSortDirection(sortDirection === 'ascending' ? 'descending' : 'ascending');
    } else {
      setSortColumn(column.id);
      setSortDirection('ascending');
    }
  };

  // Sort data locally if no pagination (server-side sorting)
  const sortedData = useMemo(() => {
    if (!sortColumn || pagination) return data;

    const column = columns.find(c => c.id === sortColumn);
    if (!column) return data;

    return [...data].sort((a, b) => {
      const aVal = column.accessor ? column.accessor(a) : a[column.id];
      const bVal = column.accessor ? column.accessor(b) : b[column.id];

      if (aVal === bVal) return 0;
      if (aVal === null || aVal === undefined) return 1;
      if (bVal === null || bVal === undefined) return -1;

      const comparison = aVal < bVal ? -1 : 1;
      return sortDirection === 'ascending' ? comparison : -comparison;
    });
  }, [data, sortColumn, sortDirection, columns, pagination]);

  // Build headings
  const headings = columns.map(col => ({
    title: col.header,
    id: col.id,
  }));

  // Build rows
  const rowMarkup = sortedData.map((row, index) => {
    const rowId = row.id || index;
    const isSelected = selectedItems.includes(rowId);

    return (
      <IndexTable.Row
        id={rowId}
        key={rowId}
        selected={isSelected}
        position={index}
        onClick={onRowClick ? () => onRowClick(row) : undefined}
      >
        {columns.map(col => {
          const value = col.accessor ? col.accessor(row) : row[col.id];
          const rendered = col.render ? col.render(value, row) : value;

          return (
            <IndexTable.Cell key={col.id}>
              {rendered ?? '-'}
            </IndexTable.Cell>
          );
        })}
      </IndexTable.Row>
    );
  });

  // Loading state
  if (loading && data.length === 0) {
    return (
      <Card>
        <div style={{ display: 'flex', justifyContent: 'center', padding: '40px' }}>
          <Spinner size="large" />
        </div>
      </Card>
    );
  }

  // Empty state
  if (!loading && data.length === 0 && emptyState) {
    return (
      <Card>
        <EmptyState
          heading={emptyState.heading}
          action={emptyState.action}
          image=""
        >
          <p>{emptyState.description}</p>
        </EmptyState>
      </Card>
    );
  }

  return (
    <Card>
      <BlockStack gap="400">
        {(searchable || filters.length > 0) && (
          <div style={{ padding: '16px 16px 0 16px' }}>
            <InlineStack gap="400" align="space-between" blockAlign="start">
              {searchable && (
                <div style={{ maxWidth: '400px', flex: 1 }}>
                  <TextField
                    value={searchValue}
                    onChange={onSearchChange}
                    placeholder={searchPlaceholder}
                    autoComplete="off"
                    clearButton
                    onClearButtonClick={() => onSearchChange('')}
                  />
                </div>
              )}
              {filters.length > 0 && (
                <InlineStack gap="200">
                  {filters.map(filter => (
                    <Select
                      key={filter.key}
                      label={filter.label}
                      labelHidden
                      options={[
                        { label: `All ${filter.label}`, value: '' },
                        ...filter.options,
                      ]}
                      value={appliedFilters.find(f => f.key === filter.key)?.value || ''}
                      onChange={(value) => {
                        if (onFiltersChange) {
                          const newFilters = appliedFilters.filter(f => f.key !== filter.key);
                          if (value) {
                            newFilters.push({ key: filter.key, value });
                          }
                          onFiltersChange(newFilters);
                        }
                      }}
                    />
                  ))}
                </InlineStack>
              )}
            </InlineStack>
          </div>
        )}

        <IndexTable
          resourceName={resourceName}
          itemCount={data.length}
          headings={headings}
          selectable={selectable}
          selectedItemsCount={selectedItems.length}
          onSelectionChange={onSelectionChange}
          sortable={columns.map(c => c.sortable || false)}
          sortDirection={sortDirection}
          sortColumnIndex={columns.findIndex(c => c.id === sortColumn)}
          onSort={handleSort}
          loading={loading}
        >
          {rowMarkup}
        </IndexTable>

        {pagination && pagination.totalPages > 1 && (
          <div style={{ display: 'flex', justifyContent: 'center', padding: '16px' }}>
            <Pagination
              hasPrevious={pagination.page > 1}
              hasNext={pagination.page < pagination.totalPages}
              onPrevious={() => pagination.onPageChange(pagination.page - 1)}
              onNext={() => pagination.onPageChange(pagination.page + 1)}
              label={`Page ${pagination.page} of ${pagination.totalPages}`}
            />
          </div>
        )}
      </BlockStack>
    </Card>
  );
}

/**
 * Helper hook for managing table state
 */
export function useTableState(initialPageSize = 25) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(initialPageSize);
  const [searchValue, setSearchValue] = useState('');
  const [appliedFilters, setAppliedFilters] = useState([]);
  const [selectedItems, setSelectedItems] = useState([]);

  const offset = (page - 1) * pageSize;

  const reset = () => {
    setPage(1);
    setSearchValue('');
    setAppliedFilters([]);
    setSelectedItems([]);
  };

  return {
    page,
    setPage,
    pageSize,
    setPageSize,
    offset,
    searchValue,
    setSearchValue,
    appliedFilters,
    setAppliedFilters,
    selectedItems,
    setSelectedItems,
    reset,
  };
}

export default InvictaTable;
