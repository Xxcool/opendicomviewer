import type { SVGProps } from 'react';

export type AnnotationIconName = 'undo' | 'redo' | 'save' | 'trash' | 'close' | 'list' | 'select' | 'length' | 'arrow' | 'text' | 'rectangle' | 'ellipse' | 'angle' | 'curve' | 'freehand' | 'chevron';
const paths: Record<AnnotationIconName, string> = {
  undo: 'M9 5 4 10l5 5M4 10h10a6 6 0 0 1 6 6v3',
  redo: 'm15 5 5 5-5 5M20 10H10a6 6 0 0 0-6 6v3',
  save: 'M5 3h12l4 4v14H3V3h2Zm2 0v6h10V3M7 21v-8h10v8',
  trash: 'M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7',
  close: 'm6 6 12 12M6 18 18 6',
  list: 'M9 5h12M9 12h12M9 19h12M3 5h1M3 12h1M3 19h1',
  select: 'm4 3 15 9-7 2-3 7Z',
  length: 'm4 17 13-13 3 3L7 20Zm8-10 3 3M9 10l3 3M6 13l3 3',
  arrow: 'M4 20 20 4M10 4h10v10',
  text: 'M4 5V3h16v2M12 3v18M8 21h8',
  rectangle: 'M4 5h16v14H4Z',
  ellipse: 'M21 12a9 7 0 1 1-18 0 9 7 0 1 1 18 0Z',
  angle: 'm5 4 3 15h13M10 12a7 7 0 0 1 6 7',
  curve: 'M3 18C5 1 18 23 21 6M2 18h2M20 6h2',
  freehand: 'M3 16C2 6 8 3 10 7s-7 15-1 14S23 7 19 4s-5 9 2 11',
  chevron: 'm7 10 5 5 5-5',
};
export function AnnotationIcon({ name, ...props }: SVGProps<SVGSVGElement> & { name: AnnotationIconName }) {
  return <svg className="annotation-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}><path d={paths[name]} /></svg>;
}
