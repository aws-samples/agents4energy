"use client"
// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0
import React, { forwardRef, useEffect, useRef } from 'react';

import Avatar from '@cloudscape-design/chat-components/avatar';
import ButtonGroup from '@cloudscape-design/components/button-group';
import StatusIndicator from '@cloudscape-design/components/status-indicator';

import { AuthorAvatarProps } from './config';

export function ChatBubbleAvatar({ type, name, loading }: AuthorAvatarProps) {
  if (type === 'gen-ai') {
    return <Avatar color="gen-ai" iconName="gen-ai" tooltipText={name} ariaLabel={name} loading={loading} />;
  }

  return <Avatar tooltipText={name} ariaLabel={name} />;
}

export function CodeViewActions() {
  return (
    <ButtonGroup
      variant="icon"
      onItemClick={() => void 0}
      items={[
        {
          type: 'group',
          text: 'Feedback',
          items: [
            {
              type: 'icon-button',
              id: 'run-command',
              iconName: 'play',
              text: 'Run command',
            },
            {
              type: 'icon-button',
              id: 'send-cloudshell',
              iconName: 'script',
              text: 'Send to IDE',
            },
          ],
        },
        {
          type: 'icon-button',
          id: 'copy',
          iconName: 'copy',
          text: 'Copy',
          popoverFeedback: <StatusIndicator type="success">Message copied</StatusIndicator>,
        },
      ]}
    />
  );
}

export function Actions() {
  return (
    <ButtonGroup
      variant="icon"
      onItemClick={() => void 0}
      items={[
        {
          type: 'icon-button',
          id: 'copy',
          iconName: 'copy',
          text: 'Copy',
          popoverFeedback: <StatusIndicator type="success">Message copied</StatusIndicator>,
        },
      ]}
    />
  );
}

export const FittedContainer = ({ children }: { children: React.ReactNode }) => {
  return (
    <div style={{ position: 'relative', flexGrow: 1 }}>
      <div style={{ position: 'absolute', inset: 0 }}>{children}</div>
    </div>
  );
};

// export const ScrollableContainer = forwardRef(function ScrollableContainer(
//   { children }: { children: React.ReactNode },
//   ref: React.Ref<HTMLDivElement>
// ) {
//   return (
//     <div style={{ position: 'relative', blockSize: '100%' }}>
//       <div style={{ position: 'absolute', inset: 0, overflowY: 'auto' }} ref={ref}>
//         {children}
//       </div>
//     </div>
//   );
// });
export const ScrollableContainer = forwardRef(function ScrollableContainer(
  { children }: { children: React.ReactNode },
  ref: React.ForwardedRef<HTMLDivElement>
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);

  // Combine refs
  const setRefs = (element: HTMLDivElement | null) => {
    // innerRef.current = element;
    (innerRef as React.MutableRefObject<HTMLDivElement | null>).current = element
    if (typeof ref === 'function') {
      ref(element);
    } else if (ref && 'current' in ref) {
      // Type guard to ensure ref is MutableRefObject
      (ref as React.MutableRefObject<HTMLDivElement | null>).current = element;
    }
  };

  useEffect(() => {
    const element = innerRef.current;
    if (!element) return;

    // Function to check if scroll is near bottom
    const isNearBottom = () => {
      const threshold = 100; // pixels from bottom
      const pixelsFromBottom = element.scrollHeight - element.scrollTop - element.clientHeight
      console.log('pixelsFromBottom: ', pixelsFromBottom)
      return (
        pixelsFromBottom <= threshold
      );
    };

    // If scroll position is near bottom, scroll to bottom
    if (isNearBottom()) {
      element.scrollTop = element.scrollHeight;
    }
  }, [children]); // Re-run when children change

  return (
    <div 
      ref={containerRef} 
      style={{ position: 'relative', blockSize: '100%' }}
    >
      <div 
        ref={setRefs}
        style={{ position: 'absolute', inset: 0, overflowY: 'auto' }}
      >
        {children}
      </div>
    </div>
  );
});