import React, { useState, useCallback } from 'react';
import {
  Modal,
  Text,
  BlockStack,
  TextField,
  Banner,
  InlineStack,
} from '@shopify/polaris';
import { InvictaButton, InvictaButtonGroup } from './InvictaButton.jsx';
import { generateIdempotencyKey } from '../../utils/api.jsx';

/**
 * InvictaConfirmModal - Confirmation modal for irreversible actions
 *
 * Props:
 * - open: boolean
 * - onClose: function
 * - onConfirm: function(idempotencyKey) - Receives idempotency key
 * - title: string
 * - message: string
 * - confirmText: string
 * - variant: 'default' | 'danger' | 'warning'
 * - loading: boolean
 * - requiresConfirmation: boolean - Require typing to confirm
 * - confirmationText: string - Text user must type
 * - showIdempotencyWarning: boolean - Show warning about idempotency
 */
export function InvictaConfirmModal({
  open,
  onClose,
  onConfirm,
  title = 'Confirm Action',
  message,
  confirmText = 'Confirm',
  cancelText = 'Cancel',
  variant = 'default',
  loading = false,
  requiresConfirmation = false,
  confirmationText = 'CONFIRM',
  showIdempotencyWarning = true,
}) {
  const [typedConfirmation, setTypedConfirmation] = useState('');
  const [idempotencyKey] = useState(() => generateIdempotencyKey());

  const isConfirmDisabled = requiresConfirmation &&
    typedConfirmation.toUpperCase() !== confirmationText.toUpperCase();

  const handleConfirm = useCallback(() => {
    onConfirm(idempotencyKey);
    setTypedConfirmation('');
  }, [onConfirm, idempotencyKey]);

  const handleClose = useCallback(() => {
    setTypedConfirmation('');
    onClose();
  }, [onClose]);

  const getBannerTone = () => {
    switch (variant) {
      case 'danger':
        return 'critical';
      case 'warning':
        return 'warning';
      default:
        return 'info';
    }
  };

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title={title}
      primaryAction={{
        content: confirmText,
        onAction: handleConfirm,
        loading,
        disabled: isConfirmDisabled,
        destructive: variant === 'danger',
      }}
      secondaryActions={[
        {
          content: cancelText,
          onAction: handleClose,
        },
      ]}
    >
      <Modal.Section>
        <BlockStack gap="400">
          {message && (
            <Text variant="bodyMd">{message}</Text>
          )}

          {variant === 'danger' && (
            <Banner tone="critical">
              This action cannot be undone.
            </Banner>
          )}

          {variant === 'warning' && (
            <Banner tone="warning">
              Please review before proceeding.
            </Banner>
          )}

          {showIdempotencyWarning && (
            <Banner tone="info">
              <Text variant="bodySm">
                This action is protected by an idempotency key. If there's a network
                error, you can safely retry - the action won't be duplicated.
              </Text>
            </Banner>
          )}

          {requiresConfirmation && (
            <BlockStack gap="200">
              <Text variant="bodyMd">
                Type <strong>{confirmationText}</strong> to confirm:
              </Text>
              <TextField
                value={typedConfirmation}
                onChange={setTypedConfirmation}
                autoComplete="off"
                placeholder={confirmationText}
              />
            </BlockStack>
          )}
        </BlockStack>
      </Modal.Section>
    </Modal>
  );
}

/**
 * Hook for managing confirm modal state
 */
export function useConfirmModal() {
  const [isOpen, setIsOpen] = useState(false);
  const [config, setConfig] = useState({});
  const [loading, setLoading] = useState(false);

  const open = useCallback((modalConfig) => {
    setConfig(modalConfig);
    setIsOpen(true);
    setLoading(false);
  }, []);

  const close = useCallback(() => {
    setIsOpen(false);
    setConfig({});
    setLoading(false);
  }, []);

  const confirm = useCallback(async (idempotencyKey) => {
    if (config.onConfirm) {
      setLoading(true);
      try {
        await config.onConfirm(idempotencyKey);
        close();
      } catch (err) {
        setLoading(false);
        throw err;
      }
    }
  }, [config, close]);

  return {
    isOpen,
    config,
    loading,
    open,
    close,
    confirm,
  };
}

/**
 * InvictaDeleteConfirmModal - Pre-configured for delete operations
 */
export function InvictaDeleteConfirmModal({
  open,
  onClose,
  onConfirm,
  itemName = 'this item',
  loading = false,
}) {
  return (
    <InvictaConfirmModal
      open={open}
      onClose={onClose}
      onConfirm={onConfirm}
      title="Delete Confirmation"
      message={`Are you sure you want to delete ${itemName}? This action cannot be undone.`}
      confirmText="Delete"
      variant="danger"
      loading={loading}
      requiresConfirmation
      confirmationText="DELETE"
    />
  );
}

/**
 * InvictaDispatchConfirmModal - Pre-configured for dispatch operations
 */
export function InvictaDispatchConfirmModal({
  open,
  onClose,
  onConfirm,
  batchId,
  orderCount,
  loading = false,
}) {
  return (
    <InvictaConfirmModal
      open={open}
      onClose={onClose}
      onConfirm={onConfirm}
      title="Confirm Dispatch"
      message={`You are about to confirm dispatch for batch ${batchId} containing ${orderCount} order(s). Stock will be decremented and orders marked as DISPATCHED.`}
      confirmText="Confirm Dispatch"
      variant="warning"
      loading={loading}
      showIdempotencyWarning
    />
  );
}

export default InvictaConfirmModal;
