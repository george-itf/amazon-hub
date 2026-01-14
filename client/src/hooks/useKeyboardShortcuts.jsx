import { useEffect, useCallback, useState } from 'react';
import { useNavigate } from 'react-router-dom';

/**
 * Keyboard shortcuts hook
 *
 * Available shortcuts:
 * - g + d: Go to Dashboard
 * - g + o: Go to Orders
 * - g + p: Go to Picklists
 * - g + c: Go to Components
 * - g + b: Go to Bundles
 * - g + l: Go to Listings
 * - g + r: Go to Review Queue
 * - g + s: Go to Stock/Replenishment
 * - g + a: Go to Audit
 * - /: Focus search (if available)
 * - ?: Show keyboard shortcuts help
 */
export function useKeyboardShortcuts({ onShowHelp }) {
  const navigate = useNavigate();
  const [pendingPrefix, setPendingPrefix] = useState(null);

  const handleKeyDown = useCallback((event) => {
    // Ignore when typing in inputs, textareas, or select elements
    const target = event.target;
    const tagName = target.tagName.toLowerCase();
    const isEditable = tagName === 'input' || tagName === 'textarea' || tagName === 'select' || target.isContentEditable;

    // Allow ? to show help even in inputs (with Shift)
    if (event.key === '?' && event.shiftKey) {
      event.preventDefault();
      onShowHelp?.();
      return;
    }

    // Skip other shortcuts when editing
    if (isEditable) {
      return;
    }

    // Handle "g" prefix for navigation
    if (event.key === 'g' && !event.ctrlKey && !event.metaKey && !event.altKey) {
      setPendingPrefix('g');
      // Clear prefix after 1 second
      setTimeout(() => setPendingPrefix(null), 1000);
      return;
    }

    // Handle navigation with "g" prefix
    if (pendingPrefix === 'g') {
      const navMap = {
        'd': '/',           // Dashboard
        'o': '/orders',     // Orders
        'p': '/picklists',  // Picklists
        'c': '/components', // Components
        'b': '/bundles',    // Bundles
        'l': '/listings',   // Listings
        'r': '/review',     // Review
        's': '/replenishment', // Stock/Replenishment
        'a': '/audit',      // Audit
        't': '/returns',    // Returns
        'f': '/profit',     // Profit (finance)
      };

      const route = navMap[event.key.toLowerCase()];
      if (route) {
        event.preventDefault();
        navigate(route);
      }
      setPendingPrefix(null);
      return;
    }

    // "/" to focus search
    if (event.key === '/' && !event.ctrlKey && !event.metaKey) {
      event.preventDefault();
      // Try to find and focus a search input
      const searchInput = document.querySelector('input[placeholder*="Search"], input[type="search"]');
      if (searchInput) {
        searchInput.focus();
        searchInput.select();
      }
      return;
    }

    // "?" for help
    if (event.key === '?') {
      event.preventDefault();
      onShowHelp?.();
      return;
    }

    // Escape to blur focused element
    if (event.key === 'Escape') {
      if (document.activeElement && document.activeElement !== document.body) {
        document.activeElement.blur();
      }
      return;
    }
  }, [navigate, onShowHelp, pendingPrefix]);

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  return { pendingPrefix };
}

/**
 * Keyboard shortcuts definitions for display
 */
export const KEYBOARD_SHORTCUTS = [
  {
    category: 'Navigation',
    shortcuts: [
      { keys: ['g', 'd'], description: 'Go to Dashboard' },
      { keys: ['g', 'o'], description: 'Go to Orders' },
      { keys: ['g', 'p'], description: 'Go to Picklists' },
      { keys: ['g', 'c'], description: 'Go to Components' },
      { keys: ['g', 'b'], description: 'Go to Bundles' },
      { keys: ['g', 'l'], description: 'Go to Listings' },
      { keys: ['g', 'r'], description: 'Go to Review Queue' },
      { keys: ['g', 's'], description: 'Go to Stock/Replenishment' },
      { keys: ['g', 'a'], description: 'Go to Audit Log' },
      { keys: ['g', 't'], description: 'Go to Returns' },
      { keys: ['g', 'f'], description: 'Go to Profit/Finance' },
    ],
  },
  {
    category: 'Actions',
    shortcuts: [
      { keys: ['/'], description: 'Focus search field' },
      { keys: ['Esc'], description: 'Unfocus / Close modal' },
      { keys: ['?'], description: 'Show keyboard shortcuts' },
    ],
  },
];
