import React, { useState, useEffect, useCallback } from 'react';
import {
  Modal,
  FormLayout,
  TextField,
  Banner,
  Text,
  BlockStack,
  InlineStack,
  Tag,
  Button,
  Spinner,
} from '@shopify/polaris';
import { getListingSetting, updateListingSettings } from '../utils/api.jsx';

/**
 * ListingSettingsModal - Modal for editing per-listing settings
 *
 * Props:
 * - open: boolean - Whether modal is visible
 * - listing: object - The listing_memory record being edited
 * - onClose: () => void - Called when modal closes
 * - onSave: (data) => void - Called after successful save
 */
export default function ListingSettingsModal({
  open,
  listing,
  onClose,
  onSave,
}) {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  // Form state
  const [priceOverride, setPriceOverride] = useState('');
  const [quantityCap, setQuantityCap] = useState('');
  const [quantityOverride, setQuantityOverride] = useState('');
  const [minMargin, setMinMargin] = useState('');
  const [targetMargin, setTargetMargin] = useState('');
  const [shippingProfileId, setShippingProfileId] = useState('');
  const [tags, setTags] = useState([]);
  const [groupKey, setGroupKey] = useState('');
  const [newTag, setNewTag] = useState('');

  // Load existing settings when modal opens
  const loadSettings = useCallback(async () => {
    if (!listing?.id) return;

    setLoading(true);
    setError(null);
    try {
      const data = await getListingSetting(listing.id);

      // Populate form with existing values
      if (data.price_override_pence != null) {
        setPriceOverride((data.price_override_pence / 100).toFixed(2));
      } else {
        setPriceOverride('');
      }
      setQuantityCap(data.quantity_cap?.toString() || '');
      setQuantityOverride(data.quantity_override?.toString() || '');
      setMinMargin(data.min_margin_override?.toString() || '');
      setTargetMargin(data.target_margin_override?.toString() || '');
      setShippingProfileId(data.shipping_profile_id || '');
      setTags(data.tags || []);
      setGroupKey(data.group_key || '');
    } catch (err) {
      console.error('Failed to load listing settings:', err);
      // Not an error if no settings exist yet
    } finally {
      setLoading(false);
    }
  }, [listing?.id]);

  useEffect(() => {
    if (open && listing) {
      loadSettings();
    }
  }, [open, listing, loadSettings]);

  // Reset form when modal closes
  useEffect(() => {
    if (!open) {
      setPriceOverride('');
      setQuantityCap('');
      setQuantityOverride('');
      setMinMargin('');
      setTargetMargin('');
      setShippingProfileId('');
      setTags([]);
      setGroupKey('');
      setNewTag('');
      setError(null);
    }
  }, [open]);

  const handleAddTag = () => {
    const tag = newTag.trim();
    if (tag && !tags.includes(tag)) {
      setTags([...tags, tag]);
    }
    setNewTag('');
  };

  const handleRemoveTag = (tagToRemove) => {
    setTags(tags.filter(t => t !== tagToRemove));
  };

  const handleSave = async () => {
    if (!listing?.id) return;

    setSaving(true);
    setError(null);

    try {
      const payload = {
        price_override_pence: priceOverride
          ? Math.round(parseFloat(priceOverride) * 100)
          : null,
        quantity_cap: quantityCap ? parseInt(quantityCap, 10) : null,
        quantity_override: quantityOverride ? parseInt(quantityOverride, 10) : null,
        min_margin_override: minMargin ? parseFloat(minMargin) : null,
        target_margin_override: targetMargin ? parseFloat(targetMargin) : null,
        shipping_profile_id: shippingProfileId || null,
        tags,
        group_key: groupKey || null,
      };

      const data = await updateListingSettings(listing.id, payload);

      if (onSave) {
        onSave(data);
      }
      onClose();
    } catch (err) {
      setError(err.message || 'Failed to save settings');
    } finally {
      setSaving(false);
    }
  };

  // Auto-suggest group key from SKU
  const suggestGroupKey = () => {
    if (listing?.sku) {
      // Extract base SKU (remove variant suffix like -BLK, -WHT, etc.)
      const baseSku = listing.sku.replace(/-[A-Z]{2,4}$/, '').replace(/-\d+$/, '');
      setGroupKey(baseSku);
    } else if (listing?.asin) {
      setGroupKey(listing.asin);
    }
  };

  if (!listing) return null;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Settings: ${listing.asin || listing.sku || 'Listing'}`}
      primaryAction={{
        content: 'Save',
        onAction: handleSave,
        loading: saving,
      }}
      secondaryActions={[
        {
          content: 'Cancel',
          onAction: onClose,
        },
      ]}
    >
      <Modal.Section>
        {loading ? (
          <div style={{ padding: '40px', textAlign: 'center' }}>
            <Spinner size="large" />
          </div>
        ) : (
          <BlockStack gap="400">
            {error && (
              <Banner tone="critical" onDismiss={() => setError(null)}>
                <p>{error}</p>
              </Banner>
            )}

            {/* Listing info */}
            <InlineStack gap="400">
              {listing.asin && (
                <BlockStack gap="100">
                  <Text variant="bodySm" tone="subdued">ASIN</Text>
                  <Text variant="bodyMd" fontWeight="semibold">{listing.asin}</Text>
                </BlockStack>
              )}
              {listing.sku && (
                <BlockStack gap="100">
                  <Text variant="bodySm" tone="subdued">SKU</Text>
                  <Text variant="bodyMd" fontWeight="semibold">{listing.sku}</Text>
                </BlockStack>
              )}
            </InlineStack>

            <FormLayout>
              {/* Pricing */}
              <TextField
                label="Sell-out Price Override"
                type="number"
                value={priceOverride}
                onChange={setPriceOverride}
                prefix="£"
                step="0.01"
                helpText="Override the price used for margin calculations. Leave empty to use ASP or Keepa buybox."
                autoComplete="off"
              />

              {/* Quantity controls */}
              <FormLayout.Group>
                <TextField
                  label="Quantity Cap"
                  type="number"
                  value={quantityCap}
                  onChange={setQuantityCap}
                  min="0"
                  helpText="Maximum quantity to allocate (algorithm respects this limit)"
                  autoComplete="off"
                />
                <TextField
                  label="Quantity Override"
                  type="number"
                  value={quantityOverride}
                  onChange={setQuantityOverride}
                  min="0"
                  helpText="Force specific quantity (bypasses allocation algorithm)"
                  autoComplete="off"
                />
              </FormLayout.Group>

              {/* Margin overrides */}
              <FormLayout.Group>
                <TextField
                  label="Min Margin %"
                  type="number"
                  value={minMargin}
                  onChange={setMinMargin}
                  suffix="%"
                  min="0"
                  max="100"
                  step="0.1"
                  helpText="Minimum margin threshold (default: 10%)"
                  autoComplete="off"
                />
                <TextField
                  label="Target Margin %"
                  type="number"
                  value={targetMargin}
                  onChange={setTargetMargin}
                  suffix="%"
                  min="0"
                  max="100"
                  step="0.1"
                  helpText="Target margin for bonus (default: 15%)"
                  autoComplete="off"
                />
              </FormLayout.Group>

              {/* Tags */}
              <BlockStack gap="200">
                <Text variant="bodySm" fontWeight="semibold">Tags</Text>
                <InlineStack gap="200" wrap>
                  {tags.map((tag) => (
                    <Tag key={tag} onRemove={() => handleRemoveTag(tag)}>
                      {tag}
                    </Tag>
                  ))}
                </InlineStack>
                <InlineStack gap="200" blockAlign="end">
                  <div style={{ flex: 1 }}>
                    <TextField
                      label="Add tag"
                      labelHidden
                      value={newTag}
                      onChange={setNewTag}
                      placeholder="Enter tag and press Add"
                      autoComplete="off"
                      onKeyPress={(e) => e.key === 'Enter' && handleAddTag()}
                    />
                  </div>
                  <Button onClick={handleAddTag} disabled={!newTag.trim()}>
                    Add
                  </Button>
                </InlineStack>
              </BlockStack>

              {/* Group key */}
              <InlineStack gap="200" blockAlign="end">
                <div style={{ flex: 1 }}>
                  <TextField
                    label="Group Key"
                    value={groupKey}
                    onChange={setGroupKey}
                    placeholder="e.g., DHR242Z"
                    helpText="Group related variants together for allocation visualization"
                    autoComplete="off"
                  />
                </div>
                <Button onClick={suggestGroupKey} variant="plain">
                  Suggest
                </Button>
              </InlineStack>

              {/* Shipping profile */}
              <TextField
                label="Shipping Profile ID"
                value={shippingProfileId}
                onChange={setShippingProfileId}
                placeholder="Optional shipping profile reference"
                helpText="Used to default shipping settings for this listing"
                autoComplete="off"
              />
            </FormLayout>
          </BlockStack>
        )}
      </Modal.Section>
    </Modal>
  );
}
