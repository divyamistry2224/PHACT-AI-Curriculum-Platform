# PHACT brand and design system

## Identity

The application name is **PHACT**, short for **Public Health AI Curriculum Transformation Platform**. PHACT is the product identity; ASPPH is referenced as the sponsoring or administering organization where the product context requires it.

Official logo assets live in `public/branding/` and are used without modification:

- `phact-logo-2.png` is the compact horizontal wordmark used in the authenticated shell and export preview.
- `phact-logo-1.png` is the expanded lockup used on the login experience.

The assets retain their intrinsic aspect ratios and are not cropped, recolored, or stretched.

## Tokens

The application uses CSS custom properties in `src/index.css` based on the supplied ASPPH palette:

- Foundation: navy `#00335B`, dark teal `#0F475C`, ink `#223646`.
- Interaction: blue `#006B94`, teal `#1FA59E`.
- Calls to action: orange `#F85F26`, with orange-light `#FF9124` for emphasis.
- Feedback: red `#F52911`; status indicators also include text labels and icons.
- Surfaces and borders: `#FFFFFF`, `#EBEFF2`, `#CCD6DE`, and `#99ADBD`.

Teal is reserved for selected states and progress accents. Orange is reserved for primary calls to action. Red is reserved for destructive or critical feedback.

## Typography

Source Sans 3 is loaded as the application typeface with Source Sans Pro and system fallbacks. The dense dashboard adapts the supplied ASPPH scale for usability:

- Page title: 34px / 700
- Section title: 20px / 600
- Component title: 15px / 600
- Body: 16px / 400
- Supporting text: 13-14px / 400-500

## Components and states

Buttons use 4px corners, clear borders, and visible focus rings. Primary actions use orange, secondary actions use neutral surfaces and approved borders, and destructive actions use red text/borders. Inputs use `#99ADBD` borders and teal focus rings.

Status is never conveyed by color alone: status dots are paired with text labels. The existing shared component classes preserve hover, focus-visible, disabled, loading, and reduced-motion behavior.

## Navigation and responsive behavior

The existing sidebar-based authenticated application is preserved. It uses dark teal, a teal active indicator, descriptive labels, grouped navigation, a skip link, keyboard-focus styles, and a mobile drawer with a scrim. The route registry remains centralized in `src/routes.ts`.

The ASPPH marketing guidelines were adapted for a task-oriented application: no marketing hero, public-site menu, or oversized campaign CTA was introduced. Panels remain restrained, spacing follows the existing 4/8/12/16/24/32/48 scale, and responsive breakpoints preserve upload, review, table, and export workflows.

## Accessibility requirements

- Maintain WCAG AA contrast for normal text and meaningful boundaries.
- Keep visible `:focus-visible` indicators for controls.
- Use meaningful logo alt text and `aria-hidden` for decorative icons.
- Preserve semantic headings, labels, skip navigation, and descriptive button labels.
- Pair color status cues with text.
- Honor `prefers-reduced-motion`.
- Recheck contrast and keyboard behavior whenever tokens or component states change.
