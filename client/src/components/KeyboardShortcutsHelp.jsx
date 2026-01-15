import React from 'react';
import {
  Modal,
  BlockStack,
  InlineStack,
  Text,
  Divider,
} from '@shopify/polaris';
import { KEYBOARD_SHORTCUTS } from '../hooks/useKeyboardShortcuts.jsx';

/**
 * Keyboard shortcut key badge
 */
function KeyBadge({ children }) {
  return (
    <span
      style={{
        display: 'inline-block',
        padding: '2px 8px',
        backgroundColor: '#F6F6F7',
        border: '1px solid #C4CDD5',
        borderRadius: '4px',
        fontFamily: 'monospace',
        fontSize: '12px',
        fontWeight: 600,
        minWidth: '24px',
        textAlign: 'center',
        boxShadow: '0 1px 0 rgba(0,0,0,0.1)',
      }}
    >
      {children}
    </span>
  );
}

/**
 * Keyboard shortcuts help modal
 */
export default function KeyboardShortcutsHelp({ open, onClose }) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Keyboard Shortcuts"
      secondaryActions={[{ content: 'Close', onAction: onClose }]}
    >
      <Modal.Section>
        <BlockStack gap="600">
          {KEYBOARD_SHORTCUTS.map((category, catIndex) => (
            <BlockStack gap="300" key={category.category}>
              {catIndex > 0 && <Divider />}
              <Text variant="headingSm">{category.category}</Text>
              <BlockStack gap="200">
                {category.shortcuts.map((shortcut, index) => (
                  <InlineStack
                    key={index}
                    gap="200"
                    align="space-between"
                    blockAlign="center"
                  >
                    <Text variant="bodySm">{shortcut.description}</Text>
                    <InlineStack gap="100">
                      {shortcut.keys.map((key, keyIndex) => (
                        <React.Fragment key={keyIndex}>
                          {keyIndex > 0 && (
                            <Text variant="bodySm" tone="subdued">
                              then
                            </Text>
                          )}
                          <KeyBadge>{key}</KeyBadge>
                        </React.Fragment>
                      ))}
                    </InlineStack>
                  </InlineStack>
                ))}
              </BlockStack>
            </BlockStack>
          ))}

          <Divider />

          <Text variant="bodySm" tone="subdued">
            Press <KeyBadge>?</KeyBadge> at any time to show this help.
            Navigation shortcuts use a two-key sequence: press <KeyBadge>g</KeyBadge> then
            the second key within 1 second.
          </Text>
        </BlockStack>
      </Modal.Section>
    </Modal>
  );
}
