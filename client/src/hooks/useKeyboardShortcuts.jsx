import { useEffect, useCallback, useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';

/**
 * Keyboard shortcuts hook
 *
 * Available shortcuts:
 * - g + d: Go to Dashboard
 * - g + i: Go to Inventory
 * - g + l: Go to Listings
 * - g + z: Go to ASIN Analyzer
 * - g + o: Go to Allocation
 * - g + s: Go to Shipping
 * - g + n: Go to Analytics
 * - g + a: Go to Audit
 * - g + e: Go to Settings
 * - /: Focus search (if available)
 * - ?: Show keyboard shortcuts help
 */
export function useKeyboardShortcuts({ onShowHelp }) {
  const navigate = useNavigate();
  const [pendingPrefix, setPendingPrefix] = useState(null);
  const timeoutRef = useRef(null);

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
      // Clear any existing timeout
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
      // Clear prefix after 1 second
      timeoutRef.current = setTimeout(() => setPendingPrefix(null), 1000);
      return;
    }

    // Handle navigation with "g" prefix
    if (pendingPrefix === 'g') {
      const navMap = {
        'd': '/',           // Dashboard
        'i': '/inventory',  // Inventory
        'l': '/listings',   // Listings
        'z': '/analyzer',   // ASIN Analyzer
        'o': '/allocation', // Allocation
        's': '/shipping',   // Shipping
        'n': '/analytics',  // Analytics
        'a': '/audit',      // Audit
        'e': '/settings',   // Settings
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
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      // Clear timeout on unmount to prevent memory leak
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
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
      { keys: ['g', 'i'], description: 'Go to Inventory' },
      { keys: ['g', 'l'], description: 'Go to Listings' },
      { keys: ['g', 'z'], description: 'Go to ASIN Analyzer' },
      { keys: ['g', 'o'], description: 'Go to Allocation' },
      { keys: ['g', 's'], description: 'Go to Shipping' },
      { keys: ['g', 'n'], description: 'Go to Analytics' },
      { keys: ['g', 'a'], description: 'Go to Audit Log' },
      { keys: ['g', 'e'], description: 'Go to Settings' },
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
