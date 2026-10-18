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
