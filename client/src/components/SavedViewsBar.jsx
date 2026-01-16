import React, { useState, useEffect, useCallback, useMemo } from 'react';
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
  Badge,
  Checkbox,
  Divider,
  Icon,
  Tooltip,
} from '@shopify/polaris';
import {
  PlusCircleIcon,
  SettingsIcon,
  DeleteIcon,
  EditIcon,
  ChevronUpIcon,
  ChevronDownIcon,
  ShareIcon,
  StarFilledIcon,
  StarIcon,
  PersonIcon,
  TeamIcon,
} from '@shopify/polaris-icons';
import {
  getSavedViews,
  createSavedView,
  updateSavedView,
  deleteSavedView,
  shareSavedView,
  unshareSavedView,
  setDefaultSavedView,
  reorderSavedViews,
} from '../utils/api.jsx';

/**
 * SavedViewsBar - Enhanced component for saved filter views (tabs)
 *
 * Features:
 * - Personal views and shared views (separated)
 * - Highlight current active view
 * - "Save View" button with modal
 * - "Save as Default" option
 * - Edit/Delete options for own views
 * - Share option for own views
 *
 * Props:
 * - page: 'shipping' | 'listings' | 'inventory' | 'components' | 'orders' | 'boms' | 'returns' | 'analytics' | 'review'
 * - currentFilters: object - Current filter state
 * - currentColumns: string[] - Current visible columns (optional)
 * - currentSort: { column, direction } - Current sort state (optional)
 * - activeViewId: string|number|null - Currently active view ID
 * - onApplyView: (view) => void - Called when a view is selected
 * - onSaveView: () => void - Optional callback after a view is saved
 *
 * Legacy support:
 * - context: alias for page
 */
export default function SavedViewsBar({
  page,
  context, // Legacy prop - maps to page
  currentFilters = {},
  currentColumns = [],
  currentSort = {},
  activeViewId = null,
  onApplyView,
  onSaveView,
}) {
  // Use page or fallback to context for backwards compatibility
  const pageName = page || context;

  const [views, setViews] = useState([]);
  const [personalViews, setPersonalViews] = useState([]);
  const [sharedViews, setSharedViews] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedTabIndex, setSelectedTabIndex] = useState(0);

  // Save view modal state
  const [saveModalOpen, setSaveModalOpen] = useState(false);
  const [saveViewName, setSaveViewName] = useState('');
  const [saveAsDefault, setSaveAsDefault] = useState(false);
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
    if (!pageName) return;

    setLoading(true);
    setError(null);
    try {
      const data = await getSavedViews(pageName);
      // Backend returns views with "All" prepended
      setViews(data.views || []);
      setPersonalViews(data.personal_views || []);
      setSharedViews(data.shared_views || []);
    } catch (err) {
      console.error('Failed to load views:', err);
      setError(err.message);
      // Fallback to just "All" tab
      setViews([{ id: null, name: 'All', filters: {}, columns: [], sort: {}, is_default: true }]);
      setPersonalViews([]);
      setSharedViews([]);
    } finally {
      setLoading(false);
    }
  }, [pageName]);

  useEffect(() => {
    loadViews();
  }, [loadViews]);

  // Sync selected tab with activeViewId
  useEffect(() => {
    if (!views.length) return;

    const index = views.findIndex(v =>
      activeViewId === null ? v.id === null : v.id === activeViewId
    );

    if (index !== -1 && index !== selectedTabIndex) {
      setSelectedTabIndex(index);
    }
  }, [activeViewId, views, selectedTabIndex]);

  // Handle tab change
  const handleTabChange = useCallback((index) => {
    setSelectedTabIndex(index);

    const view = views[index];
    if (view && onApplyView) {
      // Pass the full view object - parent handles applying it
      onApplyView(view);
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
      await createSavedView(pageName, saveViewName.trim(), {
        filters: currentFilters,
        columns: currentColumns,
        sort: currentSort,
        is_default: saveAsDefault,
      });

      setSaveViewName('');
      setSaveAsDefault(false);
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
      await updateSavedView(viewId, { name: editName.trim() });
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
      await deleteSavedView(viewId);
      await loadViews();
      // Reset to "All" tab if deleted view was active
      if (activeViewId === viewId) {
        setSelectedTabIndex(0);
        if (onApplyView) {
          onApplyView({ id: null, name: 'All', filters: {}, columns: [], sort: {} });
        }
      }
    } catch (err) {
      console.error('Failed to delete view:', err);
    } finally {
      setActionLoading(null);
    }
  };

  // Share view
  const handleShareView = async (viewId) => {
    setActionLoading(viewId);
    try {
      await shareSavedView(viewId);
      await loadViews();
    } catch (err) {
      console.error('Failed to share view:', err);
    } finally {
      setActionLoading(null);
    }
  };

  // Unshare view
  const handleUnshareView = async (viewId) => {
    setActionLoading(viewId);
    try {
      await unshareSavedView(viewId);
      await loadViews();
    } catch (err) {
      console.error('Failed to unshare view:', err);
    } finally {
      setActionLoading(null);
    }
  };

  // Set as default
  const handleSetDefault = async (viewId) => {
    setActionLoading(viewId);
    try {
      await setDefaultSavedView(viewId);
      await loadViews();
    } catch (err) {
      console.error('Failed to set default view:', err);
    } finally {
      setActionLoading(null);
    }
  };

  // Move view up/down
  const handleMoveView = async (viewId, direction) => {
    // Get only user-created personal views
    const userViews = personalViews.filter(v => v.is_owner);
    const currentIndex = userViews.findIndex(v => v.id === viewId);
    if (currentIndex === -1) return;

    const newIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1;
    if (newIndex < 0 || newIndex >= userViews.length) return;

    // Swap positions
    const reordered = [...userViews];
    [reordered[currentIndex], reordered[newIndex]] = [reordered[newIndex], reordered[currentIndex]];

    setActionLoading(viewId);
    try {
      await reorderSavedViews(pageName, reordered.map(v => v.id));
      await loadViews();
    } catch (err) {
      console.error('Failed to reorder views:', err);
    } finally {
      setActionLoading(null);
    }
  };

  // Build tabs from views
  const tabs = useMemo(() => {
    return views.map(view => {
      let badge = null;
      if (view.is_shared && !view.is_owner) {
        badge = <Badge tone="info" size="small">Shared</Badge>;
      } else if (view.is_default && view.id !== null) {
        badge = <Badge tone="success" size="small">Default</Badge>;
      }

      return {
        id: view.id === null ? 'all' : String(view.id),
        content: (
          <InlineStack gap="100" blockAlign="center" wrap={false}>
            <span>{view.name}</span>
            {badge}
          </InlineStack>
        ),
        accessibilityLabel: view.id === null
          ? 'All items'
          : `View: ${view.name}${view.is_shared ? ' (shared)' : ''}${view.is_default ? ' (default)' : ''}`,
      };
    });
  }, [views]);

  // Get user-created views for manage modal (only owner views)
  const ownedViews = useMemo(() => {
    return [...personalViews, ...sharedViews.filter(v => v.is_owner)];
  }, [personalViews, sharedViews]);

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
        <div style={{ flex: 1, overflow: 'auto' }}>
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
                disabled: ownedViews.length === 0,
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
          setSaveAsDefault(false);
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
              setSaveAsDefault(false);
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
                placeholder="e.g., Ready to Ship, Low Stock, Pending Review"
                autoComplete="off"
                autoFocus
              />

              <Checkbox
                label="Set as default view"
                checked={saveAsDefault}
                onChange={setSaveAsDefault}
                helpText="This view will be automatically applied when you open this page"
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
                maxHeight: '150px',
                overflow: 'auto',
              }}>
                {JSON.stringify({ filters: currentFilters, columns: currentColumns, sort: currentSort }, null, 2)}
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
            {ownedViews.length === 0 ? (
              <Text tone="subdued">No saved views yet. Apply filters and save them as a view.</Text>
            ) : (
              <>
                {/* Personal Views Section */}
                {personalViews.length > 0 && (
                  <>
                    <InlineStack gap="200" blockAlign="center">
                      <Icon source={PersonIcon} tone="subdued" />
                      <Text variant="headingSm">My Views</Text>
                    </InlineStack>

                    {personalViews.map((view, index) => (
                      <ViewManagementRow
                        key={view.id}
                        view={view}
                        index={index}
                        totalCount={personalViews.length}
                        isEditing={editingView === view.id}
                        editName={editName}
                        setEditName={setEditName}
                        actionLoading={actionLoading}
                        onRename={handleRenameView}
                        onDelete={handleDeleteView}
                        onShare={handleShareView}
                        onUnshare={handleUnshareView}
                        onSetDefault={handleSetDefault}
                        onMove={handleMoveView}
                        onStartEdit={(v) => {
                          setEditingView(v.id);
                          setEditName(v.name);
                        }}
                        onCancelEdit={() => {
                          setEditingView(null);
                          setEditName('');
                        }}
                      />
                    ))}
                  </>
                )}

                {/* Shared Views Section (only owned) */}
                {sharedViews.filter(v => v.is_owner).length > 0 && (
                  <>
                    {personalViews.length > 0 && <Divider />}

                    <InlineStack gap="200" blockAlign="center">
                      <Icon source={TeamIcon} tone="subdued" />
                      <Text variant="headingSm">Shared by Me</Text>
                    </InlineStack>

                    {sharedViews.filter(v => v.is_owner).map((view, index) => (
                      <ViewManagementRow
                        key={view.id}
                        view={view}
                        index={index}
                        totalCount={sharedViews.filter(v => v.is_owner).length}
                        isEditing={editingView === view.id}
                        editName={editName}
                        setEditName={setEditName}
                        actionLoading={actionLoading}
                        onRename={handleRenameView}
                        onDelete={handleDeleteView}
                        onShare={handleShareView}
                        onUnshare={handleUnshareView}
                        onSetDefault={handleSetDefault}
                        onMove={handleMoveView}
                        onStartEdit={(v) => {
                          setEditingView(v.id);
                          setEditName(v.name);
                        }}
                        onCancelEdit={() => {
                          setEditingView(null);
                          setEditName('');
                        }}
                      />
                    ))}
                  </>
                )}
              </>
            )}
          </BlockStack>
        </Modal.Section>
      </Modal>
    </>
  );
}

/**
 * ViewManagementRow - Row component for managing a single view
 */
function ViewManagementRow({
  view,
  index,
  totalCount,
  isEditing,
  editName,
  setEditName,
  actionLoading,
  onRename,
  onDelete,
  onShare,
  onUnshare,
  onSetDefault,
  onMove,
  onStartEdit,
  onCancelEdit,
}) {
  const isLoading = actionLoading === view.id;

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '12px',
        backgroundColor: '#F6F6F7',
        borderRadius: '8px',
      }}
    >
      {isEditing ? (
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
            onClick={() => onRename(view.id)}
            loading={isLoading}
          >
            Save
          </Button>
          <Button
            size="slim"
            variant="plain"
            onClick={onCancelEdit}
          >
            Cancel
          </Button>
        </InlineStack>
      ) : (
        <>
          <InlineStack gap="200" blockAlign="center">
            <Text variant="bodyMd" fontWeight="semibold">{view.name}</Text>
            {view.is_default && (
              <Badge tone="success" size="small">Default</Badge>
            )}
            {view.is_shared && (
              <Badge tone="info" size="small">Shared</Badge>
            )}
          </InlineStack>

          <InlineStack gap="100">
            {/* Move up button */}
            <Tooltip content="Move up">
              <Button
                icon={ChevronUpIcon}
                variant="plain"
                accessibilityLabel={`Move ${view.name} up`}
                disabled={index === 0}
                loading={isLoading}
                onClick={() => onMove(view.id, 'up')}
              />
            </Tooltip>

            {/* Move down button */}
            <Tooltip content="Move down">
              <Button
                icon={ChevronDownIcon}
                variant="plain"
                accessibilityLabel={`Move ${view.name} down`}
                disabled={index === totalCount - 1}
                loading={isLoading}
                onClick={() => onMove(view.id, 'down')}
              />
            </Tooltip>

            {/* Set as default button */}
            <Tooltip content={view.is_default ? 'Currently default' : 'Set as default'}>
              <Button
                icon={view.is_default ? StarFilledIcon : StarIcon}
                variant="plain"
                tone={view.is_default ? 'success' : undefined}
                accessibilityLabel={view.is_default ? `${view.name} is default` : `Set ${view.name} as default`}
                disabled={view.is_default}
                loading={isLoading}
                onClick={() => onSetDefault(view.id)}
              />
            </Tooltip>

            {/* Share/Unshare button */}
            <Tooltip content={view.is_shared ? 'Stop sharing' : 'Share with team'}>
              <Button
                icon={ShareIcon}
                variant="plain"
                tone={view.is_shared ? 'critical' : undefined}
                accessibilityLabel={view.is_shared ? `Stop sharing ${view.name}` : `Share ${view.name}`}
                loading={isLoading}
                onClick={() => view.is_shared ? onUnshare(view.id) : onShare(view.id)}
              />
            </Tooltip>

            {/* Rename button */}
            <Tooltip content="Rename">
              <Button
                icon={EditIcon}
                variant="plain"
                accessibilityLabel={`Rename ${view.name}`}
                onClick={() => onStartEdit(view)}
              />
            </Tooltip>

            {/* Delete button */}
            <Tooltip content="Delete">
              <Button
                icon={DeleteIcon}
                variant="plain"
                tone="critical"
                accessibilityLabel={`Delete ${view.name}`}
                loading={isLoading}
                onClick={() => onDelete(view.id)}
              />
            </Tooltip>
          </InlineStack>
        </>
      )}
    </div>
  );
}
