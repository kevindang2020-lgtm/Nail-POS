// lucide-react stand-in for the one-screen harness ONLY: same box (24 px default), a plain outline glyph. Never shipped.
import React from 'react';
const icon = (name) => function Icon({ size = 24, ...rest }) { return React.createElement('svg', { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, 'data-icon': name, ...rest }, React.createElement('rect', { x: 5, y: 5, width: 14, height: 14, rx: 2 })); };
export const Trash2 = icon('Trash2');
