import React from 'react';
import { Button, Spinner } from '@shopify/polaris';

/**
 * InvictaButton - Styled button with Invicta brand colors
 *
 * Props:
 * - variant: 'primary' | 'secondary' | 'danger' | 'success'
 * - size: 'slim' | 'medium' | 'large'
 * - loading: boolean - Show loading spinner
 * - disabled: boolean
 * - fullWidth: boolean
 * - onClick: function
 * - children: ReactNode
 * - icon: ReactNode - Icon to show before text
 */
export function InvictaButton({
  variant = 'primary',
  size = 'medium',
  loading = false,
  disabled = false,
  fullWidth = false,
  onClick,
  children,
  icon,
  ...props
}) {
  // Map variants to Polaris tones
  const getTone = () => {
    switch (variant) {
      case 'danger':
        return 'critical';
      case 'success':
        return 'success';
      default:
        return undefined;
    }
  };

  // Custom styling for Invicta orange primary button
  const customStyle = variant === 'primary' ? {
    '--p-button-bg': '#F26522',
    '--p-button-bg-hover': '#D65A1C',
    '--p-button-bg-active': '#C04D14',
  } : {};

  return (
    <div style={customStyle}>
      <Button
        variant={variant === 'secondary' ? 'secondary' : 'primary'}
        tone={getTone()}
        size={size}
        loading={loading}
        disabled={disabled || loading}
        fullWidth={fullWidth}
        onClick={onClick}
        icon={icon}
        {...props}
      >
        {children}
      </Button>
    </div>
  );
}

/**
 * InvictaButtonGroup - Group of buttons with consistent spacing
 */
export function InvictaButtonGroup({ children, align = 'left', gap = '8px' }) {
  const style = {
    display: 'flex',
    gap,
    justifyContent: align === 'right' ? 'flex-end' : align === 'center' ? 'center' : 'flex-start',
    flexWrap: 'wrap',
  };

  return <div style={style}>{children}</div>;
}

export default InvictaButton;
