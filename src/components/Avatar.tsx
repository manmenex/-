import { avatarColor, initials } from '../lib/format';
import type { Member } from '../core/types';

export function Avatar({
  member,
  size = 32,
  dimmed = false,
}: {
  member: Pick<Member, 'name' | 'colorSeed'>;
  size?: number;
  dimmed?: boolean;
}) {
  return (
    <span
      aria-hidden
      className="inline-flex shrink-0 items-center justify-center rounded-full font-medium text-paper"
      style={{
        width: size,
        height: size,
        fontSize: Math.round(size * 0.44),
        background: avatarColor(member.colorSeed),
        opacity: dimmed ? 0.28 : 1,
      }}
    >
      {initials(member.name)}
    </span>
  );
}
