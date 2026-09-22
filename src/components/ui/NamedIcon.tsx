import {
  BowArrow,
  Bot,
  BrickWall,
  Castle,
  Flag,
  Flame,
  HardHat,
  Lamp,
  Map,
  Mountain,
  Shield,
  Sparkles,
  Swords,
  Zap,
  type LucideIcon,
} from 'lucide-react';

/** Lucide icons that data (faction/collection `icon` fields) may name. */
export const NAMED_ICONS: Record<string, LucideIcon> = {
  'bow-arrow': BowArrow,
  bot: Bot,
  'brick-wall': BrickWall,
  castle: Castle,
  flag: Flag,
  flame: Flame,
  'hard-hat': HardHat,
  lamp: Lamp,
  map: Map,
  mountain: Mountain,
  shield: Shield,
  sparkles: Sparkles,
  swords: Swords,
  zap: Zap,
};

/** Renders a data-driven icon by lucide name; an unknown value (legacy emoji) is shown as text. */
export function NamedIcon({ name, className }: { name: string; className?: string }) {
  const Icon = NAMED_ICONS[name];
  return Icon ? <Icon className={className} aria-hidden /> : <>{name}</>;
}
