import {
  CircleCheckIcon,
  InfoIcon,
  Loader2Icon,
  OctagonXIcon,
  TriangleAlertIcon,
} from 'lucide-react';
import { Toaster as Sonner, type ToasterProps } from 'sonner';

const Toaster = ({ ...props }: ToasterProps) => {
  return (
    <Sonner
      theme={'light'}
      className="toaster group"
      position="bottom-right"
      richColors
      icons={{
        success: <CircleCheckIcon className="size-4" />,
        info: <InfoIcon className="size-4" />,
        warning: <TriangleAlertIcon className="size-4" />,
        error: <OctagonXIcon className="size-4" />,
        loading: <Loader2Icon className="size-4 animate-spin" />,
      }}
      style={
        {
          '--normal-bg': 'var(--popover)',
          '--normal-text': 'var(--popover-foreground)',
          '--normal-border': 'var(--border)',
          '--border-radius': 'var(--radius)',
          // each kind of toast takes the colours the diff highlighting uses, with the text darkened to read on the tint; info keeps the normal ones
          '--success-bg': 'var(--added-tint)',
          '--success-border': 'var(--added)',
          '--success-text':
            'color-mix(in oklab, var(--added) 60%, var(--foreground))',
          '--warning-bg': 'var(--modified-tint)',
          '--warning-border': 'var(--modified)',
          '--warning-text':
            'color-mix(in oklab, var(--modified) 45%, var(--foreground))',
          '--error-bg': 'var(--removed-tint)',
          '--error-border': 'var(--destructive)',
          '--error-text':
            'color-mix(in oklab, var(--destructive) 75%, var(--foreground))',
          '--info-bg': 'var(--popover)',
          '--info-border': 'var(--border)',
          '--info-text': 'var(--popover-foreground)',
        } as React.CSSProperties
      }
      toastOptions={{
        classNames: {
          toast: 'cn-toast',
        },
      }}
      {...props}
    />
  );
};

export { Toaster };
