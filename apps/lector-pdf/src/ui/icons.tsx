import type { SVGProps } from 'react';

// Iconos SVG 20×20 con currentColor. Los decorativos se ocultan a lectores de pantalla:
// el nombre accesible lo da el botón que los contiene.
function Svg(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      width={20}
      height={20}
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...props}
    />
  );
}

export function IconUndo() {
  return (
    <Svg>
      <path d="M7 5 3.5 8.5 7 12" />
      <path d="M4 8.5h8.5a4 4 0 0 1 0 8H9" />
    </Svg>
  );
}

export function IconRedo() {
  return (
    <Svg>
      <path d="M13 5l3.5 3.5L13 12" />
      <path d="M16 8.5H7.5a4 4 0 0 0 0 8H11" />
    </Svg>
  );
}

export function IconMore() {
  return (
    <Svg>
      <circle cx="4.5" cy="10" r="1.1" fill="currentColor" stroke="none" />
      <circle cx="10" cy="10" r="1.1" fill="currentColor" stroke="none" />
      <circle cx="15.5" cy="10" r="1.1" fill="currentColor" stroke="none" />
    </Svg>
  );
}

export function IconOpen() {
  return (
    <Svg>
      <path d="M2.5 5.5a1.5 1.5 0 0 1 1.5-1.5h3.2l1.6 1.8h7.2a1.5 1.5 0 0 1 1.5 1.5v7.7a1.5 1.5 0 0 1-1.5 1.5H4a1.5 1.5 0 0 1-1.5-1.5z" />
    </Svg>
  );
}

export function IconZoomIn() {
  return (
    <Svg>
      <circle cx="8.5" cy="8.5" r="5.5" />
      <path d="M12.5 12.5 17 17" />
      <path d="M8.5 6v5M6 8.5h5" />
    </Svg>
  );
}

export function IconZoomOut() {
  return (
    <Svg>
      <circle cx="8.5" cy="8.5" r="5.5" />
      <path d="M12.5 12.5 17 17" />
      <path d="M6 8.5h5" />
    </Svg>
  );
}

export function IconRotateLeft() {
  return (
    <Svg>
      <path d="M4.5 10a5.5 5.5 0 1 0 1.6-3.9" />
      <path d="M4.5 3.5V6.5h3" />
    </Svg>
  );
}

export function IconRotateRight() {
  return (
    <Svg>
      <path d="M15.5 10a5.5 5.5 0 1 1-1.6-3.9" />
      <path d="M15.5 3.5V6.5h-3" />
    </Svg>
  );
}

export function IconPrevPage() {
  return (
    <Svg>
      <path d="M12.5 5 7.5 10l5 5" />
    </Svg>
  );
}

export function IconNextPage() {
  return (
    <Svg>
      <path d="M7.5 5l5 5-5 5" />
    </Svg>
  );
}

export function IconSelect() {
  return (
    <Svg>
      <path d="M5 3.5 15 9.5l-4.6 1.1L8.2 15.6z" />
      <path d="M11.2 12.4 14.5 16" />
    </Svg>
  );
}

export function IconSidebar() {
  return (
    <Svg>
      <rect x="2.5" y="3.5" width="15" height="13" rx="1.5" />
      <path d="M7.5 3.5v13" />
    </Svg>
  );
}

export function IconHand() {
  return (
    <Svg>
      <path d="M7 10.5V4.8a1.3 1.3 0 0 1 2.6 0v4.2" />
      <path d="M9.6 8.5V3.6a1.3 1.3 0 0 1 2.6 0v5" />
      <path d="M12.2 8.6V4.8a1.3 1.3 0 0 1 2.6 0V11" />
      <path d="M14.8 9.4a1.3 1.3 0 0 1 2.4.6v2.2c0 3-2 5.2-5.1 5.2-2.3 0-3.6-1.1-4.7-2.9L4.5 11.2a1.3 1.3 0 0 1 2.1-1.5L7 10.5" />
    </Svg>
  );
}

export function IconSave() {
  return (
    <Svg>
      <path d="M4 3.5h9.5L16.5 6.5V16a.5.5 0 0 1-.5.5H4a.5.5 0 0 1-.5-.5V4a.5.5 0 0 1 .5-.5Z" />
      <path d="M6.5 3.5v4h6v-4" />
      <path d="M6.5 16.5v-5h7v5" />
    </Svg>
  );
}

export function IconSaveAs() {
  return (
    <Svg>
      <path d="M4 3.5h9.5L16.5 6.5V9" />
      <path d="M4 3.5v13a.5.5 0 0 0 .5.5H9" />
      <path d="M6.5 3.5v4h6v-4" />
      <path d="M14 15.5h4M16 13.5v4" />
    </Svg>
  );
}

export function IconAppearance() {
  return (
    <Svg>
      <circle cx="10" cy="10" r="6.5" />
      <path d="M10 3.5a6.5 6.5 0 0 1 0 13z" fill="currentColor" />
    </Svg>
  );
}

export function IconComment() {
  return (
    <Svg>
      <path d="M3.5 4.5h13a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H9l-3.5 3v-3h-2a1 1 0 0 1-1-1v-8a1 1 0 0 1 1-1z" />
    </Svg>
  );
}

export function IconHighlight() {
  return (
    <Svg>
      <path d="M5.5 11.5 11.5 5.5l3 3-6 6h-3z" />
      <path d="M3.5 16.5h13" />
    </Svg>
  );
}

export function IconUnderline() {
  return (
    <Svg>
      <path d="M6 4v6a4 4 0 0 0 8 0V4" />
      <path d="M4 17.5h12" />
    </Svg>
  );
}

export function IconStrikeout() {
  return (
    <Svg>
      <path d="M4 10h12" />
      <path d="M7 5.5h6M7 14.5h6" />
    </Svg>
  );
}

export function IconCopy() {
  return (
    <Svg>
      <rect x={7} y={7} width={9.5} height={9.5} rx={1.5} />
      <path d="M4.5 12.5v-8a1.5 1.5 0 0 1 1.5-1.5h8" />
    </Svg>
  );
}

export function IconNote() {
  return (
    <Svg>
      <path d="M3.5 3.5h13v9l-4 4h-9z" />
      <path d="M7 7.5h6M7 10.5h4" />
    </Svg>
  );
}

export function IconFreeText() {
  return (
    <Svg>
      <path d="M4.5 5h11M10 5v11M7.5 16h5" />
    </Svg>
  );
}

export function IconInk() {
  return (
    <Svg>
      <path d="M13.5 3.5l3 3L8 15l-4 1 1-4z" />
      <path d="M11.5 5.5l3 3" />
    </Svg>
  );
}

export function IconColor() {
  return (
    <Svg>
      <path d="M10 3c-3.5 4-5.5 6.5-5.5 9a5.5 5.5 0 0 0 11 0c0-2.5-2-5-5.5-9z" />
    </Svg>
  );
}

export function IconInkWidth() {
  return (
    <Svg>
      <path d="M3.5 5h13" strokeWidth={0.8} />
      <path d="M3.5 10h13" strokeWidth={2.4} />
      <path d="M3.5 15.5h13" strokeWidth={4.5} />
    </Svg>
  );
}

export function IconFontSize() {
  return (
    <Svg>
      <path d="M2.5 16 6 5l3.5 11M3.8 12h4.4" />
      <path d="M13 16V8.5M16.5 16V5" />
    </Svg>
  );
}

export function IconTrash() {
  return (
    <Svg>
      <path d="M4 5.5h12M8 5.5V3.8h4v1.7M5.5 5.5l.7 10.2h7.6l.7-10.2" />
      <path d="M8.5 8.5v5M11.5 8.5v5" />
    </Svg>
  );
}

export function IconClose() {
  return (
    <Svg>
      <path d="M5 5l10 10M15 5L5 15" />
    </Svg>
  );
}
