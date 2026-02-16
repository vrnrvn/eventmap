# Eventmap Design System

A distinctive, location-centric visual language that avoids generic "AI slop" aesthetics. The system prioritizes warmth, depth, and editorial character.

---

## Typography

### Font Stack

| Role | Font | Usage |
|------|------|-------|
| **Display / Headings** | Syne | Event titles, section headers, sheet summary, filter titles |
| **Body / UI** | DM Sans | Meta text, descriptions, buttons, form labels |

### Syne (Display)
- **Weights**: 400 Regular, 500 Medium, 600 SemiBold, 700 Bold, 800 ExtraBold
- **Character**: Bold, editorial, geometric with personality
- **Use for**: Anything that needs to command attention or feel curated

### DM Sans (Body)
- **Weights**: 400 Regular, 500 Medium, 600 SemiBold, 700 Bold
- **Character**: Clean, readable, slightly rounded
- **Use for**: Body copy, metadata, secondary information

### Size Scale

| Token | Size | Use |
|-------|------|-----|
| xs | 12px | Labels, captions, badges |
| sm | 14px | Meta text, secondary copy |
| md | 16px | Body, sheet summary |
| lg | 18px | Event titles, section headers |
| xl | 24px | Page titles |
| xxl | 32px | Hero text |
| xxxl | 48px | Display |

---

## Color Palette

### Primary: Terracotta `#C45C3E`
Warm, earthy, place-centric. Evokes maps, destinations, and human-scale locations.
- **Dark**: `#A34A2F`
- **Light**: `#D47A5F`
- **Use**: Primary actions, accents, active states, premium badge

### Secondary: Deep Teal `#0D4F4F`
Geography, water, depth. Grounds the warmth.
- **Dark**: `#083838`
- **Light**: `#1A6B6B`
- **Use**: Category badges, secondary UI, links

### Accent: Warm Amber `#E8A838`
Energy, events, highlights.
- **Dark**: `#C98E1F`
- **Light**: `#F0BC5C`
- **Use**: Premium features, highlights, CTAs

### Neutrals

| Token | Hex | Use |
|-------|-----|-----|
| text.primary | #1C1C1C | Headlines, primary copy |
| text.secondary | #5C5C5C | Meta, descriptions |
| text.tertiary | #8A8A8A | Placeholders, disabled |
| background.primary | #FAF8F5 | Main app background (warm cream) |
| background.secondary | #F2EFE9 | Cards, sheet, surfaces |
| background.tertiary | #E8E4DC | Deeper contrast |
| border.light | #E8E4DC | Subtle dividers |
| border.medium | #D4CFC4 | Input borders |

---

## Spacing

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

## Border Radius

| Token | Value | Use |
|-------|-------|-----|
| sm | 6px | Badges, small chips |
| md | 12px | Buttons, icons |
| lg | 18px | Inputs, filter chips |
| xl | 24px | Cards, modals |
| xxl | 32px | Sheet, large surfaces |
| round | 9999px | Pills, avatars |

---

## Shadows

- **sm**: Subtle elevation, 1px offset, 3px blur
- **md**: Cards, dropdowns, 3px offset, 8px blur
- **lg**: Modals, overlays, 6px offset, 16px blur
- **card**: Warm tint with terracotta `#C45C3E` at 8% opacity – gives cards a subtle depth without cold gray

---

## Motion

- **Staggered entry**: Event cards use `FadeInDown` with 60ms delay per index, springified (damping 18)
- **Sheet header**: `FadeIn` 400ms on load
- **Micro-interactions**: `activeOpacity` 0.92 on cards for subtle press feedback

---

## Layout Principles

1. **Asymmetry**: Alternate event cards offset with `marginLeft` (e.g. every odd index) to break the grid
2. **Generous negative space**: Avoid cramming; let content breathe
3. **Depth over flat**: Use layered shadows, warm borders, and subtle background tints
4. **Warm cream base**: Never pure white (#FFFFFF) – use #FAF8F5 for primary background

---

## Anti-Patterns (Avoid)

- Inter, Roboto, Arial
- Purple gradients
- Flat white/gray backgrounds
- Symmetric, templated card grids
- Evenly distributed color palettes
- Scattered, low-impact animations

---

## File References

- **Theme constants**: `constants/theme.ts`
- **Category colors**: `constants/categories.ts`
- **Fonts**: `app/_layout.tsx` (Syne, DM Sans)
