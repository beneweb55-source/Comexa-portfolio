/*
 * Point d'entrée du design system « soft UI pastel dans une coque noire ».
 *
 *   import { KpiGrid, FilterPills, ItemGrid, ItemCard, Button } from "@/components/softui";
 */

export { default as Shell, useShellQuery } from "./Shell";
export { default as Navbar } from "./Navbar";
export { default as SideRail } from "./SideRail";
export { default as PageHeader } from "./PageHeader";
export { default as AdminDeskPanel } from "./AdminDeskPanel";
export { default as Dock } from "./Dock";
export { default as KpiCard, KpiGrid } from "./KpiCard";
export { default as ItemCard, ItemGrid, ProgressBar } from "./ItemCard";
export { default as Tooltip } from "./Tooltip";
export { Panel, ActivityList, HealthList } from "./panels";
export { Alert, Button, FilterPills, IconButton, Pill, SectionHead, StatusPill, StatusPillFor, toneBackground } from "./primitives";
export { SoftMotionProvider, cardHover, cardRest, pageTransition, staggerItem, staggerParent } from "./motion";
export { MOTION, TONES, TONE_CYCLE, statusTone, toneAt } from "./tokens";
export { formatRelativeTime } from "./time";
export { notificationMeta } from "./notification-map";
