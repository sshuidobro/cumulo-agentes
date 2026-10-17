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

export function IconOpen() {
  return (
    <Svg>
      <path d="M2.5 5.5a1.5 1.5 0 0 1 1.5-1.5h3.2l1.6 1.8h7.2a1.5 1.5 0 0 1 1.5 1.5v7.7a1.5 1.5 0 0 1-1.5 1.5H4a1.5 1.5 0 0 1-1.5-1.5z" />
    </Svg>
  );
}
