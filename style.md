# Eventmap Design System

A clean, location-centric visual language built around the Eventmap brand red. All values below mirror `constants/theme.ts` — the code is the source of truth.

---

## Typography

### Font Stack

| Role | Font | Token | Usage |
|------|------|-------|-------|
| **Display / Headings** | Plus Jakarta Sans | `Typography.displayFontFamilies` | Event titles, section headers, page titles |
| **Body / UI** | DM Sans | `Typography.fontFamilies` | Body copy, descriptions, buttons, form labels |
| **Labels / Metadata** | Inter | `Typography.labelFontFamilies` | Compact UI labels, badges, meta rows |

### Plus Jakarta Sans (Display)
- **Weights**: 400 Regular, 500 Medium, 600 SemiBold, 700 Bold, 800 ExtraBold
- **Character**: Modern, neutral, geometric
- **Use for**: Anything that needs to command attention or feel curated

### DM Sans (Body)
- **Weights**: 400 Regular, 500 Medium, 600 SemiBold, 700 Bold
- **Character**: Clean, readable, slightly rounded
- **Use for**: Body copy, metadata, secondary information

### Inter (Labels)
- **Weights**: 400 Regular, 500 Medium, 600 SemiBold
- **Use for**: Small labels and compact UI metadata

### Size Scale (`Typography.sizes`)

| Token | Size | Use |
|-------|------|-----|
| xxs | 11px | Smallest legible label — tiny badges and pills only |
| xs | 12px | Labels, captions, badges |
| sm | 14px | Meta text, secondary copy |
| md | 16px | Body text |
| lg | 18px | Event titles, section headers |
| xl | 24px | Page titles |
| xxl | 32px | Hero text |
| xxxl | 48px | Display |

Weights: `Typography.weights` — 400 / 500 / 600 / 700 / 800 (extrabold). Line heights: `Typography.lineHeights` — tight 1.2, normal 1.5, relaxed 1.75.

---

## Color Palette (`Colors`)

### Primary: Brand Red `#B41924`
The Eventmap brand color. Primary actions, active states, highlights.
- **Dark**: `#A3041A`
- **Light**: `#FF7671`
- **Soft tint**: `Colors.primarySoft` — `rgba(180, 25, 36, 0.10)` for badge/chip backgrounds and glows

### Secondary: Warm Orange-Brown `#9B3E20`
- **Dark**: `#8B3315`
- **Light**: `#FFC4B3`
- **Use**: Secondary UI, warm accents

### Accent: Pink `#FF8EAA`
- **Dark**: `#B40953`
- **Light**: `#FFEFF0`
- **Use**: Highlights and badges

### Status

| Token | Hex | Soft tint |
|-------|-----|-----------|
| success | #2D8A6E | `Colors.successSoft` |
| successText | #1F7058 | — (text/icons on light backgrounds; AA-safe) |
| warning | #D4A017 | `Colors.warningSoft` |
| warningText | #8A6A00 | — (text/icons on light backgrounds; AA-safe) |
| error | #B41340 | `Colors.errorSoft` |
| premium | #B40953 | `Colors.premiumSoft` |

### Neutrals

| Token | Hex | Use |
|-------|-----|-----|
| text.primary | #2D2F2F | Headlines, primary copy |
| text.secondary | #5A5C5C | Meta, descriptions |
| text.tertiary | #6B6C6C | Placeholders, hints |
| text.disabled | #9C9D9D | Disabled states |
| text.inverse | #FFEFEE | Text on dark/brand surfaces |
| white | #FFFFFF | Text/icons on filled brand surfaces |
| surface | #FFFFFF | Cards and elevated surfaces |
| background.primary | #F6F6F6 | Main app background (light gray) |
| background.secondary | #F0F1F1 | Elevated surfaces, inputs |
| background.tertiary | #E7E8E8 | Deeper contrast |
| background.dark | #0C0F0F | Dark overlays / splash |
| border.light | #DBDDDD | Subtle dividers |
| border.medium | #8E8F8F | Input borders |
| border.dark | #767777 | Strong outlines |
| neutralSoft | rgba(45, 47, 47, 0.06) | Muted chips, icon wells |

Overlays: `Colors.overlay.light/medium/dark` — black-based rgba at 0.08 / 0.25 / 0.55.

### Alpha helper

Never concatenate alpha hex onto tokens (`Colors.primary + '14'`). Use:

```ts
import { alpha, Colors } from '@/constants/theme';
alpha(Colors.primary, 0.12); // rgba(180, 25, 36, 0.12)
```

or the prebuilt soft tokens (`primarySoft`, `errorSoft`, `successSoft`, `warningSoft`, `premiumSoft`, `neutralSoft`).

---

## Spacing (`Spacing`)

| Token | Value | Use |
|-------|-------|-----|
| xs | 4px | Tight gaps |
| sm | 8px | Inline spacing |
| md | 16px | Default padding |
| lg | 24px | Section spacing |
| xl | 32px | Large gaps |
| xxl | 48px | Major sections |
| xxxl | 64px | Hero spacing |

---

## Border Radius (`BorderRadius`)

| Token | Value | Use |
|-------|-------|-----|
| sm | 6px | Badges, small chips |
| md | 12px | Buttons, icons |
| lg | 18px | Inputs, filter chips |
| xl | 24px | Cards, modals |
| xxl | 32px | Sheet, large surfaces |
| round | 9999px | Pills, avatars |

---

## Shadows (`Shadows`)

All shadows use a neutral dark base (`#1C1C1C` / `#2D2F2F`):

- **sm**: Subtle elevation — 1px offset, 3px blur, 6% opacity
- **md**: Cards, dropdowns — 3px offset, 8px blur, 10% opacity
- **lg**: Modals, overlays — 6px offset, 16px blur, 12% opacity
- **card**: Softer card shadow — 4px offset, 12px blur, 8% opacity

---

## Motion

- **Staggered entry**: Event cards use `FadeInDown` with 60ms delay per index, springified (damping 18)
- **Sheet header**: `FadeIn` 400ms on load
- **Micro-interactions**: `activeOpacity` 0.92 on cards for subtle press feedback

---

## Layout Principles

1. **Cards on gray**: White `Colors.surface` cards on the `#F6F6F6` background — never background-on-background
2. **Generous negative space**: Avoid cramming; let content breathe
3. **Depth over flat**: Use layered shadows, light borders, and soft brand tints
4. **One accent at a time**: Brand red carries the hierarchy; soft tints support it

---

## Anti-Patterns (Avoid)

- Raw hex/rgba in screens — use theme tokens
- `Colors.primary + '14'` style alpha concatenation — use `alpha()` or soft tokens
- Local `const Palette = {...}` copies of theme values
- Old-brand remnants: terracotta `#C45C3E`, teal `#0D4F4F`, amber `#E8A838`
- Purple gradients
- Same color for card and screen background (invisible cards/badges)

Exempt: third-party brand assets (Google/Facebook logo colors) keep their official hexes.

---

## File References

- **Theme constants**: `constants/theme.ts` (`Colors`, `Spacing`, `BorderRadius`, `Typography`, `Shadows`, `alpha()`)
- **Category colors**: `constants/categories.ts`
- **Fonts**: `app/_layout.tsx` (Plus Jakarta Sans, DM Sans, Inter via `@expo-google-fonts`)
