/**
 * Lucide icons the phone draws, as shapes in a 24x24 box: the same icons the
 * desktop imports from `lucide-solid`, so both apps look alike on iOS and
 * Android (SF Symbols only exist on iOS). Generated from lucide-static 0.544.0.
 * Lucide is ISC License, Copyright (c) Lucide Icons and Contributors.
 */
export type LucideShape =
  | { kind: "path"; d: string }
  | { kind: "circle"; cx: number; cy: number; r: number; fill?: string }
  | { kind: "line"; x1: number; y1: number; x2: number; y2: number }
  | { kind: "rect"; x: number; y: number; width: number; height: number; rx?: number; ry?: number }
  | { kind: "polyline"; points: string }
  | { kind: "polygon"; points: string }
  | { kind: "ellipse"; cx: number; cy: number; rx: number; ry: number };

export const ICONS = {
  "archive": [{"kind": "rect", "width": 20.0, "height": 5.0, "x": 2.0, "y": 3.0, "rx": 1.0}, {"kind": "path", "d": "M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8"}, {"kind": "path", "d": "M10 12h4"}],
  "arrow-down": [{"kind": "path", "d": "M12 5v14"}, {"kind": "path", "d": "m19 12-7 7-7-7"}],
  "arrow-left": [{"kind": "path", "d": "m12 19-7-7 7-7"}, {"kind": "path", "d": "M19 12H5"}],
  "arrow-up": [{"kind": "path", "d": "m5 12 7-7 7 7"}, {"kind": "path", "d": "M12 19V5"}],
  "at-sign": [{"kind": "circle", "cx": 12.0, "cy": 12.0, "r": 4.0}, {"kind": "path", "d": "M16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-4 8"}],
  "bell": [{"kind": "path", "d": "M10.268 21a2 2 0 0 0 3.464 0"}, {"kind": "path", "d": "M3.262 15.326A1 1 0 0 0 4 17h16a1 1 0 0 0 .74-1.673C19.41 13.956 18 12.499 18 8A6 6 0 0 0 6 8c0 4.499-1.411 5.956-2.738 7.326"}],
  "brain": [{"kind": "path", "d": "M12 18V5"}, {"kind": "path", "d": "M15 13a4.17 4.17 0 0 1-3-4 4.17 4.17 0 0 1-3 4"}, {"kind": "path", "d": "M17.598 6.5A3 3 0 1 0 12 5a3 3 0 1 0-5.598 1.5"}, {"kind": "path", "d": "M17.997 5.125a4 4 0 0 1 2.526 5.77"}, {"kind": "path", "d": "M18 18a4 4 0 0 0 2-7.464"}, {"kind": "path", "d": "M19.967 17.483A4 4 0 1 1 12 18a4 4 0 1 1-7.967-.517"}, {"kind": "path", "d": "M6 18a4 4 0 0 1-2-7.464"}, {"kind": "path", "d": "M6.003 5.125a4 4 0 0 0-2.526 5.77"}],
  "check": [{"kind": "path", "d": "M20 6 9 17l-5-5"}],
  "chevron-down": [{"kind": "path", "d": "m6 9 6 6 6-6"}],
  "chevron-right": [{"kind": "path", "d": "m9 18 6-6-6-6"}],
  "clock": [{"kind": "path", "d": "M12 6v6l4 2"}, {"kind": "circle", "cx": 12.0, "cy": 12.0, "r": 10.0}],
  "copy": [{"kind": "rect", "width": 14.0, "height": 14.0, "x": 8.0, "y": 8.0, "rx": 2.0, "ry": 2.0}, {"kind": "path", "d": "M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"}],
  "corner-down-left": [{"kind": "path", "d": "M20 4v7a4 4 0 0 1-4 4H4"}, {"kind": "path", "d": "m9 10-5 5 5 5"}],
  "external-link": [{"kind": "path", "d": "M15 3h6v6"}, {"kind": "path", "d": "M10 14 21 3"}, {"kind": "path", "d": "M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"}],
  "file": [{"kind": "path", "d": "M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"}, {"kind": "path", "d": "M14 2v4a2 2 0 0 0 2 2h4"}],
  "folder": [{"kind": "path", "d": "M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"}],
  "git-branch": [{"kind": "line", "x1": 6.0, "x2": 6.0, "y1": 3.0, "y2": 15.0}, {"kind": "circle", "cx": 18.0, "cy": 6.0, "r": 3.0}, {"kind": "circle", "cx": 6.0, "cy": 18.0, "r": 3.0}, {"kind": "path", "d": "M18 9a9 9 0 0 1-9 9"}],
  "git-merge": [{"kind": "circle", "cx": 18.0, "cy": 18.0, "r": 3.0}, {"kind": "circle", "cx": 6.0, "cy": 6.0, "r": 3.0}, {"kind": "path", "d": "M6 21V9a9 9 0 0 0 9 9"}],
  "git-pull-request": [{"kind": "circle", "cx": 18.0, "cy": 18.0, "r": 3.0}, {"kind": "circle", "cx": 6.0, "cy": 6.0, "r": 3.0}, {"kind": "path", "d": "M13 6h3a2 2 0 0 1 2 2v7"}, {"kind": "line", "x1": 6.0, "x2": 6.0, "y1": 9.0, "y2": 21.0}],
  "git-pull-request-closed": [{"kind": "circle", "cx": 6.0, "cy": 6.0, "r": 3.0}, {"kind": "path", "d": "M6 9v12"}, {"kind": "path", "d": "m21 3-6 6"}, {"kind": "path", "d": "m21 9-6-6"}, {"kind": "path", "d": "M18 11.5V15"}, {"kind": "circle", "cx": 18.0, "cy": 18.0, "r": 3.0}],
  "git-pull-request-draft": [{"kind": "circle", "cx": 18.0, "cy": 18.0, "r": 3.0}, {"kind": "circle", "cx": 6.0, "cy": 6.0, "r": 3.0}, {"kind": "path", "d": "M18 6V5"}, {"kind": "path", "d": "M18 11v-1"}, {"kind": "line", "x1": 6.0, "x2": 6.0, "y1": 9.0, "y2": 21.0}],
  "image": [{"kind": "rect", "width": 18.0, "height": 18.0, "x": 3.0, "y": 3.0, "rx": 2.0, "ry": 2.0}, {"kind": "circle", "cx": 9.0, "cy": 9.0, "r": 2.0}, {"kind": "path", "d": "m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"}],
  "key-round": [{"kind": "path", "d": "M2.586 17.414A2 2 0 0 0 2 18.828V21a1 1 0 0 0 1 1h3a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h1a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h.172a2 2 0 0 0 1.414-.586l.814-.814a6.5 6.5 0 1 0-4-4z"}, {"kind": "circle", "cx": 16.5, "cy": 7.5, "r": 0.5, "fill": "currentColor"}],
  "list-checks": [{"kind": "path", "d": "M13 5h8"}, {"kind": "path", "d": "M13 12h8"}, {"kind": "path", "d": "M13 19h8"}, {"kind": "path", "d": "m3 17 2 2 4-4"}, {"kind": "path", "d": "m3 7 2 2 4-4"}],
  "log-out": [{"kind": "path", "d": "m16 17 5-5-5-5"}, {"kind": "path", "d": "M21 12H9"}, {"kind": "path", "d": "M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"}],
  "paperclip": [{"kind": "path", "d": "m16 6-8.414 8.586a2 2 0 0 0 2.829 2.829l8.414-8.586a4 4 0 1 0-5.657-5.657l-8.379 8.551a6 6 0 1 0 8.485 8.485l8.379-8.551"}],
  "pin-off": [{"kind": "path", "d": "M12 17v5"}, {"kind": "path", "d": "M15 9.34V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H7.89"}, {"kind": "path", "d": "m2 2 20 20"}, {"kind": "path", "d": "M9 9v1.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h11"}],
  "pin": [{"kind": "path", "d": "M12 17v5"}, {"kind": "path", "d": "M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z"}],
  "plus": [{"kind": "path", "d": "M5 12h14"}, {"kind": "path", "d": "M12 5v14"}],
  "refresh-cw": [{"kind": "path", "d": "M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"}, {"kind": "path", "d": "M21 3v5h-5"}, {"kind": "path", "d": "M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"}, {"kind": "path", "d": "M8 16H3v5"}],
  "server": [{"kind": "rect", "width": 20.0, "height": 8.0, "x": 2.0, "y": 2.0, "rx": 2.0, "ry": 2.0}, {"kind": "rect", "width": 20.0, "height": 8.0, "x": 2.0, "y": 14.0, "rx": 2.0, "ry": 2.0}, {"kind": "line", "x1": 6.0, "x2": 6.01, "y1": 6.0, "y2": 6.0}, {"kind": "line", "x1": 6.0, "x2": 6.01, "y1": 18.0, "y2": 18.0}],
  "shield": [{"kind": "path", "d": "M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"}],
  "slash": [{"kind": "path", "d": "M22 2 2 22"}],
  "sliders-horizontal": [{"kind": "path", "d": "M10 5H3"}, {"kind": "path", "d": "M12 19H3"}, {"kind": "path", "d": "M14 3v4"}, {"kind": "path", "d": "M16 17v4"}, {"kind": "path", "d": "M21 12h-9"}, {"kind": "path", "d": "M21 19h-5"}, {"kind": "path", "d": "M21 5h-7"}, {"kind": "path", "d": "M8 10v4"}, {"kind": "path", "d": "M8 12H3"}],
  "sparkles": [{"kind": "path", "d": "M11.017 2.814a1 1 0 0 1 1.966 0l1.051 5.558a2 2 0 0 0 1.594 1.594l5.558 1.051a1 1 0 0 1 0 1.966l-5.558 1.051a2 2 0 0 0-1.594 1.594l-1.051 5.558a1 1 0 0 1-1.966 0l-1.051-5.558a2 2 0 0 0-1.594-1.594l-5.558-1.051a1 1 0 0 1 0-1.966l5.558-1.051a2 2 0 0 0 1.594-1.594z"}, {"kind": "path", "d": "M20 2v4"}, {"kind": "path", "d": "M22 4h-4"}, {"kind": "circle", "cx": 4.0, "cy": 20.0, "r": 2.0}],
  "square-pen": [{"kind": "path", "d": "M12 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"}, {"kind": "path", "d": "M18.375 2.625a1 1 0 0 1 3 3l-9.013 9.014a2 2 0 0 1-.853.505l-2.873.84a.5.5 0 0 1-.62-.62l.84-2.873a2 2 0 0 1 .506-.852z"}],
  "square": [{"kind": "rect", "width": 18.0, "height": 18.0, "x": 3.0, "y": 3.0, "rx": 2.0}],
  "terminal": [{"kind": "path", "d": "M12 19h8"}, {"kind": "path", "d": "m4 17 6-6-6-6"}],
  "user-round": [{"kind": "circle", "cx": 12.0, "cy": 8.0, "r": 5.0}, {"kind": "path", "d": "M20 21a8 8 0 0 0-16 0"}],
  "x": [{"kind": "path", "d": "M18 6 6 18"}, {"kind": "path", "d": "m6 6 12 12"}],
} satisfies Record<string, LucideShape[]>;

export type IconName = keyof typeof ICONS;
