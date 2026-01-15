import React, { useState, useEffect, useCallback } from 'react';
import {
  Tabs,
  Button,
  Modal,
  TextField,
  FormLayout,
  Banner,
  Text,
  BlockStack,
  InlineStack,
  Badge,
  Spinner,
  ActionList,
  Popover,
  Icon,
} from '@shopify/polaris';
import { PlusCircleIcon, SettingsIcon, DeleteIcon, EditIcon } from '@shopify/polaris-icons';
import { getViews, createView, updateView, deleteView } from '../utils/api.jsx';

/**
 * SavedViewsBar - Displays saved filter views as tabs
 *
 * Props:
 * - context: string - The page context (e.g., 'components', 'listings')
 * - currentFilters: object - Current filter state to save
 * - onFilterChange: (filters) => void - Callback when a view is selected
 * - filterKeys: string[] - Keys to save/restore from filters (e.g., ['searchQuery', 'stockFilter', 'sortBy'])
 */
export default function SavedViewsBar({
  context,
  currentFilters = {},
  onFilterChange,
  filterKeys = [],
}) {
  const [views, setViews] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedTabIndex, setSelectedTabIndex] = useState(0);

  // Save view modal state
  const [saveModalOpen, setSaveModalOpen] = useState(false);
  const [saveViewName, setSaveViewName] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);

  // Manage views modal state
  const [manageModalOpen, setManageModalOpen] = useState(false);
  const [editingView, setEditingView] = useState(null);
  const [editName, setEditName] = useState('');
  const [deleting, setDeleting] = useState(null);

  // Actions popover
  const [actionsOpen, setActionsOpen] = useState(false);

  // Load views
  const loadViews = useCallback(async () => {
    if (!context) return;

    setLoading(true);
    setError(null);
    try {
      const data = await getViews(context);
      setViews(data.views || []);
    } catch (err) {
      console.error('Failed to load views:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [context]);

  useEffect(() => {
    loadViews();
  }, [loadViews]);

  // Handle tab change
  const handleTabChange = useCallback((index) => {
    setSelectedTabIndex(index);

    // Index 0 is always "All" - clear filters
    if (index === 0) {
      if (onFilterChange) {
        const clearedFilters = {};
        filterKeys.forEach(key => {
          clearedFilters[key] = getDefaultValue(key);
        });
        onFilterChange(clearedFilters);
      }
      return;
    }

    // Apply the selected view's filters
    const view = views[index - 1];
    if (view && view.config_json && onFilterChange) {
      onFilterChange(view.config_json);
    }
  }, [views, onFilterChange, filterKeys]);

  // Get default value for a filter key
  function getDefaultValue(key) {
    if (key.includes('search') || key.includes('query')) return '';
    if (key.includes('Filter') || key.includes('filter')) return 'all';
    if (key.includes('sort') || key.includes('Sort')) return 'sku';
    return '';
  }

  // Check if current filters match a view
  const isFilterActive = useCallback(() => {
    return filterKeys.some(key => {
      const value = currentFilters[key];
      const defaultVal = getDefaultValue(key);
      return value !== undefined && value !== defaultVal && value !== '';
    });
  }, [currentFilters, filterKeys]);

  // Save current view
  const handleSaveView = async () => {
    if (!saveViewName.trim()) {
      setSaveError('Please enter a name for this view');
      return;
    }

    setSaving(true);
    setSaveError(null);
    try {
      // Extract only the filter keys we care about
      const configToSave = {};
      filterKeys.forEach(key => {
        if (currentFilters[key] !== undefined) {
          configToSave[key] = currentFilters[key];
        }
      });

      await createView({
        context,
        name: saveViewName.trim(),
        config_json: configToSave,
      });

      setSaveViewName('');
      setSaveModalOpen(false);
      await loadViews();
    } catch (err) {
      setSaveError(err.message || 'Failed to save view');
    } finally {
      setSaving(false);
    }
  };

  // Update view name
  const handleUpdateView = async (viewId) => {
    if (!editName.trim()) return;

    try {
      await updateView(viewId, { name: editName.trim() });
      setEditingView(null);
      setEditName('');
      await loadViews();
    } catch (err) {
      console.error('Failed to update view:', err);
    }
  };

  // Delete view
  const handleDeleteView = async (viewId) => {
    setDeleting(viewId);
    try {
      await deleteView(viewId);
      await loadViews();
      // Reset to "All" tab if we deleted the selected view
      setSelectedTabIndex(0);
    } catch (err) {
      console.error('Failed to delete view:', err);
    } finally {
      setDeleting(null);
    }
  };

  // Build tabs
  const tabs = [
    { id: 'all', content: 'All', accessibilityLabel: 'All items' },
    ...views.map(view => ({
      id: view.id,
      content: view.name,
      accessibilityLabel: `View: ${view.name}`,
    })),
  ];

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 0' }}>
        <Spinner size="small" />
        <Text variant="bodySm" tone="subdued">Loading views...</Text>
      </div>
    );
  }

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
        <div style={{ flex: 1 }}>
          <Tabs tabs={tabs} selected={selectedTabIndex} onSelect={handleTabChange} fitted />
        </div>

        <Popover
          active={actionsOpen}
          activator={
            <Button
              icon={SettingsIcon}
              onClick={() => setActionsOpen(prev => !prev)}
              accessibilityLabel="View actions"
              variant="tertiary"
            />
          }
          onClose={() => setActionsOpen(false)}
          preferredAlignment="right"
        >
          <ActionList
            items={[
              {
                content: 'Save current view',
                icon: PlusCircleIcon,
                disabled: !isFilterActive(),
                helpText: isFilterActive() ? 'Save current filters as a tab' : 'Apply filters first',
                onAction: () => {
                  setActionsOpen(false);
                  setSaveModalOpen(true);
                },
              },
              {
                content: 'Manage views',
                icon: SettingsIcon,
                disabled: views.length === 0,
                onAction: () => {
                  setActionsOpen(false);
                  setManageModalOpen(true);
                },
              },
            ]}
          />
        </Popover>
      </div>

      {error && (
        <Banner tone="warning" onDismiss={() => setError(null)}>
          <p>Failed to load saved views: {error}</p>
        </Banner>
      )}

      {/* Save View Modal */}
      <Modal
        open={saveModalOpen}
        onClose={() => {
          setSaveModalOpen(false);
          setSaveViewName('');
          setSaveError(null);
        }}
        title="Save View"
        primaryAction={{
          content: 'Save',
          onAction: handleSaveView,
          loading: saving,
          disabled: !saveViewName.trim(),
        }}
        secondaryActions={[
          {
            content: 'Cancel',
            onAction: () => {
              setSaveModalOpen(false);
              setSaveViewName('');
              setSaveError(null);
            },
          },
        ]}
      >
        <Modal.Section>
          <BlockStack gap="400">
            {saveError && (
              <Banner tone="critical" onDismiss={() => setSaveError(null)}>
                <p>{saveError}</p>
              </Banner>
            )}

            <Text variant="bodyMd">
              Save your current filters as a tab for quick access.
            </Text>

            <FormLayout>
              <TextField
                label="View name"
                value={saveViewName}
                onChange={setSaveViewName}
                placeholder="e.g., Makita, Low Stock, Screws"
                autoComplete="off"
                autoFocus
              />
            </FormLayout>

            <BlockStack gap="200">
              <Text variant="bodySm" tone="subdued">Current filters to save:</Text>
              <InlineStack gap="200" wrap>
                {filterKeys.map(key => {
                  const value = currentFilters[key];
                  const defaultVal = getDefaultValue(key);
                  if (value === undefined || value === defaultVal || value === '') return null;
                  return (
                    <Badge key={key} tone="info">
                      {key}: {String(value)}
                    </Badge>
                  );
                })}
              </InlineStack>
            </BlockStack>
          </BlockStack>
        </Modal.Section>
      </Modal>

      {/* Manage Views Modal */}
      <Modal
        open={manageModalOpen}
        onClose={() => {
          setManageModalOpen(false);
          setEditingView(null);
          setEditName('');
        }}
        title="Manage Views"
        secondaryActions={[
          {
            content: 'Done',
            onAction: () => {
              setManageModalOpen(false);
              setEditingView(null);
              setEditName('');
            },
          },
        ]}
      >
        <Modal.Section>
          <BlockStack gap="400">
            {views.length === 0 ? (
              <Text tone="subdued">No saved views yet. Apply filters and save them as a view.</Text>
            ) : (
              views.map(view => (
                <div
                  key={view.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '12px',
                    backgroundColor: '#F6F6F7',
                    borderRadius: '8px',
                  }}
                >
                  {editingView === view.id ? (
                    <InlineStack gap="200" blockAlign="center" wrap={false}>
                      <TextField
                        label="View name"
                        labelHidden
                        value={editName}
                        onChange={setEditName}
                        autoComplete="off"
                        autoFocus
                      />
                      <Button size="slim" onClick={() => handleUpdateView(view.id)}>Save</Button>
                      <Button
                        size="slim"
                        variant="plain"
                        onClick={() => {
                          setEditingView(null);
                          setEditName('');
                        }}
                      >
                        Cancel
                      </Button>
                    </InlineStack>
                  ) : (
                    <>
                      <BlockStack gap="100">
                        <Text variant="bodyMd" fontWeight="semibold">{view.name}</Text>
                        <InlineStack gap="100" wrap>
                          {Object.entries(view.config_json || {}).map(([key, value]) => (
                            value && value !== 'all' && value !== '' && (
                              <Badge key={key} tone="info" size="small">
                                {key}: {String(value)}
                              </Badge>
                            )
                          ))}
                        </InlineStack>
                      </BlockStack>
                      <InlineStack gap="100">
                        <Button
                          icon={EditIcon}
                          variant="plain"
                          accessibilityLabel={`Edit ${view.name}`}
                          onClick={() => {
                            setEditingView(view.id);
                            setEditName(view.name);
                          }}
                        />
                        <Button
                          icon={DeleteIcon}
                          variant="plain"
                          tone="critical"
                          accessibilityLabel={`Delete ${view.name}`}
                          loading={deleting === view.id}
                          onClick={() => handleDeleteView(view.id)}
                        />
                      </InlineStack>
                    </>
                  )}
                </div>
              ))
            )}
          </BlockStack>
        </Modal.Section>
      </Modal>
    </>
  );
}
