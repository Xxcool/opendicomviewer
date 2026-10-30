import type { SVGProps } from 'react';

const paths = {
  upload: 'M12 16V3M7 8l5-5 5 5M4 14v6h16v-6',
  browse: 'M8 4h8M8 20h8M12 4v16M5 9l-3 3 3 3M19 9l3 3-3 3',
  window: 'M12 3a9 9 0 1 0 0 18V3Z M12 3a9 9 0 0 1 0 18',
  pan: 'M8 13V6a2 2 0 0 1 4 0v6M12 10V4a2 2 0 0 1 4 0v9M16 9a2 2 0 0 1 4 0v6c0 4-2 6-6 6h-2c-2 0-3-1-4-2l-5-6a2 2 0 0 1 3-2l2 2',
  zoom: 'M21 21l-5-5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0ZM10 6v8M6 10h8',
  fit: 'M8 3H3v5M16 3h5v5M3 16v5h5M21 16v5h-5M8 8h8v8H8Z',
  left: 'M3 4h18v16H3ZM9 4v16',
  right: 'M3 4h18v16H3ZM15 4v16',
  focus: 'M8 3H3v5M16 3h5v5M3 16v5h5M21 16v5h-5',
  help: 'M9 9a3 3 0 0 1 6 0c0 2-3 2-3 4M12 17h.01M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z',
};

export function WorkspaceIcon({ name, ...props }: SVGProps<SVGSVGElement> & { name: keyof typeof paths }) {
  return <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor"
    strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
    <path d={paths[name]} />
  </svg>;
}
