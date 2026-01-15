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
  Spinner,
  ActionList,
  Popover,
} from '@shopify/polaris';
import { PlusCircleIcon, SettingsIcon, DeleteIcon, EditIcon, ChevronUpIcon, ChevronDownIcon } from '@shopify/polaris-icons';
import { getViews, createView, updateView, deleteView, reorderViews } from '../utils/api.jsx';

/**
 * SavedViewsBar - Reusable component for saved filter views (tabs)
 *
 * Props:
 * - context: 'components' | 'listings'
 * - currentFilters: object - Current filter state (used when saving a view)
 * - onApplyView: (config) => void - Called when a view is selected, passes view.config
 * - onSaveView: () => void - Optional callback after a view is saved (for UI feedback)
 *
 * This component:
 * - Fetches and displays views as horizontal tabs
 * - "All" tab is always present (virtual, from backend)
 * - Clicking a tab calls onApplyView(config) - NO filter logic here
 * - "Save current view" opens modal, persists currentFilters as config
 * - "Manage views" allows rename, delete, reorder
 */
export default function SavedViewsBar({
  context,
  currentFilters = {},
  onApplyView,
  onSaveView,
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
  const [actionLoading, setActionLoading] = useState(null);

  // Actions popover
  const [actionsOpen, setActionsOpen] = useState(false);

  // Load views from backend
  const loadViews = useCallback(async () => {
    if (!context) return;

    setLoading(true);
    setError(null);
    try {
      const data = await getViews(context);
      // Backend returns views with "All" prepended
      setViews(data.views || []);
    } catch (err) {
      console.error('Failed to load views:', err);
      setError(err.message);
      // Fallback to just "All" tab
      setViews([{ id: null, name: 'All', config: {}, is_default: true }]);
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

    const view = views[index];
    if (view && onApplyView) {
      // Pass the config object - parent handles applying it
      onApplyView(view.config || {});
    }
  }, [views, onApplyView]);

  // Check if current filters have any active values
  const hasActiveFilters = useCallback(() => {
    if (!currentFilters || typeof currentFilters !== 'object') return false;
    return Object.values(currentFilters).some(v => {
      if (v === null || v === undefined || v === '') return false;
      if (v === 'all') return false;
      return true;
    });
  }, [currentFilters]);

  // Save current view
  const handleSaveView = async () => {
    if (!saveViewName.trim()) {
      setSaveError('Please enter a name for this view');
      return;
    }

    setSaving(true);
    setSaveError(null);
    try {
      await createView(context, saveViewName.trim(), currentFilters);

      setSaveViewName('');
      setSaveModalOpen(false);
      await loadViews();

      // Notify parent if callback provided
      if (onSaveView) {
        onSaveView();
      }
    } catch (err) {
      setSaveError(err.message || 'Failed to save view');
    } finally {
      setSaving(false);
    }
  };

  // Rename view
  const handleRenameView = async (viewId) => {
    if (!editName.trim()) return;

    setActionLoading(viewId);
    try {
      await updateView(viewId, { name: editName.trim() });
      setEditingView(null);
      setEditName('');
      await loadViews();
    } catch (err) {
      console.error('Failed to rename view:', err);
    } finally {
      setActionLoading(null);
    }
  };

  // Delete view
  const handleDeleteView = async (viewId) => {
    setActionLoading(viewId);
    try {
      await deleteView(viewId);
      await loadViews();
      // Reset to "All" tab
      setSelectedTabIndex(0);
      if (onApplyView) {
        onApplyView({});
      }
    } catch (err) {
      console.error('Failed to delete view:', err);
    } finally {
      setActionLoading(null);
    }
  };

  // Move view up/down
  const handleMoveView = async (viewId, direction) => {
    // Get only user-created views (exclude virtual "All")
    const userViews = views.filter(v => v.id !== null);
    const currentIndex = userViews.findIndex(v => v.id === viewId);
    if (currentIndex === -1) return;

    const newIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1;
    if (newIndex < 0 || newIndex >= userViews.length) return;

    // Swap positions
    const reordered = [...userViews];
    [reordered[currentIndex], reordered[newIndex]] = [reordered[newIndex], reordered[currentIndex]];

    setActionLoading(viewId);
    try {
      await reorderViews(context, reordered.map(v => v.id));
      await loadViews();
    } catch (err) {
      console.error('Failed to reorder views:', err);
    } finally {
      setActionLoading(null);
    }
  };

  // Build tabs from views
  const tabs = views.map(view => ({
    id: view.id === null ? 'all' : String(view.id),
    content: view.name,
    accessibilityLabel: view.id === null ? 'All items' : `View: ${view.name}`,
  }));

  // Get user-created views for manage modal
  const userViews = views.filter(v => v.id !== null);

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
                disabled: !hasActiveFilters(),
                helpText: hasActiveFilters() ? 'Save current filters as a tab' : 'Apply filters first',
                onAction: () => {
                  setActionsOpen(false);
                  setSaveModalOpen(true);
                },
              },
              {
                content: 'Manage views',
                icon: SettingsIcon,
                disabled: userViews.length === 0,
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
              <Text variant="bodySm" tone="subdued">Current filter configuration:</Text>
              <div style={{
                padding: '12px',
                backgroundColor: '#F6F6F7',
                borderRadius: '8px',
                fontFamily: 'monospace',
                fontSize: '12px',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-all',
              }}>
                {JSON.stringify(currentFilters, null, 2)}
              </div>
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
            {userViews.length === 0 ? (
              <Text tone="subdued">No saved views yet. Apply filters and save them as a view.</Text>
            ) : (
              userViews.map((view, index) => (
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
                      <Button
                        size="slim"
                        onClick={() => handleRenameView(view.id)}
                        loading={actionLoading === view.id}
                      >
                        Save
                      </Button>
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
                      <Text variant="bodyMd" fontWeight="semibold">{view.name}</Text>
                      <InlineStack gap="100">
                        {/* Move up button */}
                        <Button
                          icon={ChevronUpIcon}
                          variant="plain"
                          accessibilityLabel={`Move ${view.name} up`}
                          disabled={index === 0}
                          loading={actionLoading === view.id}
                          onClick={() => handleMoveView(view.id, 'up')}
                        />
                        {/* Move down button */}
                        <Button
                          icon={ChevronDownIcon}
                          variant="plain"
                          accessibilityLabel={`Move ${view.name} down`}
                          disabled={index === userViews.length - 1}
                          loading={actionLoading === view.id}
                          onClick={() => handleMoveView(view.id, 'down')}
                        />
                        {/* Rename button */}
                        <Button
                          icon={EditIcon}
                          variant="plain"
                          accessibilityLabel={`Rename ${view.name}`}
                          onClick={() => {
                            setEditingView(view.id);
                            setEditName(view.name);
                          }}
                        />
                        {/* Delete button */}
                        <Button
                          icon={DeleteIcon}
                          variant="plain"
                          tone="critical"
                          accessibilityLabel={`Delete ${view.name}`}
                          loading={actionLoading === view.id}
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
