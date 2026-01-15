import React, { useState } from 'react';
import { Icon, Text } from '@shopify/polaris';
import { ChevronDownIcon, ChevronUpIcon } from '@shopify/polaris-icons';

/**
 * InvictaSectionHeader - Section header with orange accent bar
 *
 * Props:
 * - title: string - Section title
 * - count: number - Optional count to display as chip
 * - collapsible: boolean - Whether section can collapse
 * - defaultCollapsed: boolean - Initial collapsed state
 * - children: ReactNode - Content to render when expanded
 * - action: ReactNode - Optional action button on right
 */
export function InvictaSectionHeader({
  title,
  count,
  collapsible = false,
  defaultCollapsed = false,
  children,
  action,
}) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed);

  const headerStyle = {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    padding: '12px 16px',
    borderLeft: '4px solid #F26522',
    backgroundColor: '#FAFAFA',
    cursor: collapsible ? 'pointer' : 'default',
    userSelect: 'none',
  };

  const titleContainerStyle = {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    flex: 1,
  };

  const countChipStyle = {
    backgroundColor: '#F26522',
    color: 'white',
    padding: '2px 8px',
    borderRadius: '12px',
    fontSize: '12px',
    fontWeight: '600',
  };

  const handleClick = () => {
    if (collapsible) {
      setCollapsed(!collapsed);
    }
  };

  return (
    <div>
      <div style={headerStyle} onClick={handleClick}>
        <div style={titleContainerStyle}>
          <Text variant="headingMd" as="h3">
            {title}
          </Text>
          {count !== undefined && count !== null && (
            <span style={countChipStyle}>{count}</span>
          )}
        </div>
        {action && <div onClick={e => e.stopPropagation()}>{action}</div>}
        {collapsible && (
          <Icon source={collapsed ? ChevronDownIcon : ChevronUpIcon} />
        )}
      </div>
      {(!collapsible || !collapsed) && children && (
        <div style={{ padding: '16px' }}>{children}</div>
      )}
    </div>
  );
}

export default InvictaSectionHeader;
