// Invicta UI Kit - Custom components for Amazon Hub Brain
// Uses Shopify Polaris as base with Invicta branding

export { InvictaSectionHeader } from './InvictaSectionHeader.jsx';
export { InvictaButton, InvictaButtonGroup } from './InvictaButton.jsx';
export { InvictaBadge, InvictaStockBadge, InvictaResolutionBadge } from './InvictaBadge.jsx';
export { InvictaPanel, InvictaStatPanel, InvictaPanelGrid } from './InvictaPanel.jsx';
export { InvictaTable, useTableState } from './InvictaTable.jsx';
export {
  InvictaConfirmModal,
  InvictaDeleteConfirmModal,
  InvictaDispatchConfirmModal,
  useConfirmModal
} from './InvictaConfirmModal.jsx';
export {
  InvictaLoading,
  InvictaPageLoading,
  InvictaTableLoading,
  InvictaInlineLoading,
  InvictaStatCardLoading,
  InvictaDashboardLoading
} from './InvictaLoading.jsx';
export { InvictaTimeline, InvictaActivityFeed } from './InvictaTimeline.jsx';

// Color constants for Invicta branding
export const INVICTA_COLORS = {
  primary: '#F26522',       // Invicta Orange
  primaryDark: '#D65A1C',   // Hover state
  primaryLight: '#FF8C5A',  // Light variant
  success: '#008060',       // Green
  warning: '#FFB020',       // Amber
  error: '#D72C0D',         // Red
  info: '#2C6ECB',          // Blue
  neutral: '#637381',       // Grey
  background: '#F6F6F7',    // Light grey background
  surface: '#FFFFFF',       // White
  border: '#E3E8EE',        // Border grey
};

// Status color map for consistent theming
export const STATUS_THEME = {
  // Success states
  success: { bg: '#D4EDDA', text: '#155724', border: '#C3E6CB' },
  // Warning states
  warning: { bg: '#FFF3CD', text: '#856404', border: '#FFEEBA' },
  // Error states
  error: { bg: '#F8D7DA', text: '#721C24', border: '#F5C6CB' },
  // Info states
  info: { bg: '#CCE5FF', text: '#004085', border: '#B8DAFF' },
  // Neutral states
  neutral: { bg: '#E3E8EE', text: '#637381', border: '#D3D9DF' },
};
