import {
  Calendar,
  ClipboardList,
  Heart,
  HeartIcon,
  Home,
  Plus,
  Settings,
  ShoppingCart,
  Timer,
  Wallet,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

/** Base URL of the standalone grocery app (apps/grocery-tracker-web). */
export const GROCERY_APP_URL = (
  import.meta.env.VITE_GROCERY_APP_URL || "http://localhost:6061"
).replace(/\/$/, "");

/** Base URL of the standalone pomodoro app (apps/pomodoro-tracker-web). */
export const POMODORO_APP_URL = (
  import.meta.env.VITE_POMODORO_APP_URL || "http://localhost:8081"
).replace(/\/$/, "");

export interface AppNavItem {
  label: string;
  to: string;
  icon: LucideIcon;
}

export interface MiniApp {
  id: string;
  name: string;
  slug: string;
  route: string;
  externalUrl?: string;
  icon: LucideIcon;
  emoji: string;
  description: string;
  badge?: string;
  status: "active" | "coming_soon";
  themeColor: string;
  bgLight: string;
  navItems: AppNavItem[];
  primaryAction?: {
    label: string;
    to?: string;
    actionId?: string;
    icon: LucideIcon;
  };
}

export const APPS_REGISTRY: MiniApp[] = [
  {
    id: "habit-pasutri",
    name: "Habit Pasutri",
    slug: "habbit-pasutri",
    route: "/",
    icon: Heart,
    emoji: "💖",
    description: "Pelacak kebiasaan & streak bersama pasangan",
    badge: "Core App",
    status: "active",
    themeColor: "text-pink-500",
    bgLight: "bg-pink-100",
    navItems: [
      { label: "nav.home", to: "/", icon: Home },
      { label: "nav.goals", to: "/shared-goals", icon: HeartIcon },
      { label: "nav.list_habits", to: "/list-habits", icon: ClipboardList },
      { label: "nav.activity", to: "/activity", icon: Calendar },
      { label: "nav.settings", to: "/settings", icon: Settings },
    ],
    primaryAction: {
      label: "habits.create_habit",
      to: "/habits",
      icon: Plus,
    },
  },
  {
    id: "grocery-list",
    name: "Grocery List",
    slug: "grocery-list",
    // Grocery is its own deployment now (apps/grocery-tracker-web). Every link
    // points at that app; `/grocery-list*` in this app only exists as a
    // redirect shim for old bookmarks.
    route: "#",
    externalUrl: GROCERY_APP_URL,
    icon: ShoppingCart,
    emoji: "🛒",
    description: "Daftar belanjaan & kebutuhan dapur pasutri",
    badge: "Mini App",
    status: "active",
    themeColor: "text-emerald-500",
    bgLight: "bg-emerald-100",
    navItems: [],
  },
  {
    id: "couple-finances",
    name: "Keuangan Pasutri",
    slug: "couple-finances",
    route: "#",
    externalUrl: import.meta.env.VITE_FINANCE_APP_URL || "http://localhost:5051",
    icon: Wallet,
    emoji: "💰",
    description: "Pencatatan pengeluaran & tabungan bersama",
    badge: "Mini App",
    status: "active",
    themeColor: "text-amber-500",
    bgLight: "bg-amber-100",
    navItems: [],
  },

  {
    id: "pomodoro",
    name: "Pomodoro",
    slug: "pomodoro",
    // Pomodoro is its own deployment (apps/pomodoro-tracker-web).
    route: "#",
    externalUrl: POMODORO_APP_URL,
    icon: Timer,
    emoji: "🍅",
    description: "Timer fokus pribadi dengan riwayat & statistik",
    badge: "Mini App",
    status: "active",
    themeColor: "text-rose-500",
    bgLight: "bg-red-100",
    navItems: [],
  },

  {
    id: "couple-calendar",
    name: "Jadwal & Kencan",
    slug: "couple-calendar",
    route: "#",
    icon: Calendar,
    emoji: "📅",
    description: "Kalender agenda & quality time berdua",
    badge: "Segera Hadir",
    status: "coming_soon",
    themeColor: "text-blue-500",
    bgLight: "bg-blue-100",
    navItems: [],
  },
];

export function getActiveApp(pathname: string): MiniApp {
  return APPS_REGISTRY[0];
}
