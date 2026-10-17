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
