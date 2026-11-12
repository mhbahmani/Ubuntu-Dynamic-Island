# Improve Theme Colors and Implement Real macOS-Style Frosted Glass

I want to significantly improve the visual appearance of my Ubuntu GNOME Shell extension, particularly its existing **Background Opacity** and **Matte Tone** settings.

Please inspect the existing codebase and implement a proper frosted-glass rendering system inspired by the macOS widgets and translucent panels shown in the provided reference images.

This is not simply a CSS color adjustment. I want the actual rendering behavior to change.

## 1. Current Problem

The extension currently provides two appearance settings:

- **Background Opacity (0–100%)**
- **Matte Tone (0–100%)**

Both settings are already implemented, but they don't produce the desired results.

In the screenshots, changing Matte Tone from 0 to 100 barely changes the appearance. Background windows, icons, and text remain clearly visible through the extension.

The existing implementation appears to primarily manipulate background colors, gradients, and transparency rather than creating genuine background blur.

Investigate and identify the actual cause before implementing changes.

## 2. Desired Visual Result

I want a modern frosted-glass appearance similar to macOS Notification Center widgets.

The key characteristics are:

- Genuine background blur behind the extension.
- Smooth, softly tinted translucent surfaces.
- Background objects remain recognizable as general shapes and colors but lose sharp details.
- Text, controls, and icons in the extension remain completely sharp.
- The material looks consistent and elegant against both bright and dark wallpapers.
- Subtle borders and highlights give the surface depth.
- The effect looks like frosted glass, not simply a transparent colored rectangle.

At high Matte Tone values, text or icons from windows behind the popup should no longer be clearly readable.

Avoid excessive gradients, harsh saturated colors, and overly prominent borders.

## 3. Separate Opacity From Matte Tone

These settings must have **clearly different responsibilities**.

### Background Opacity

Background Opacity should control the transparency of the popup's colored surface.

- 0%: Minimum tint opacity, allowing the background to show through.
- 25%: Lightly tinted transparent surface.
- 50%: Moderately tinted surface.
- 75%: Strongly tinted but still translucent surface.
- 100%: Fully opaque colored surface.

Changing opacity should not automatically change the blur radius.

It must not make the popup's text, icons, graphs, or controls transparent.

Apply opacity to the background material layer, not the entire container actor.

Preserve the existing setting, range, and user preferences.

### Matte Tone

Redefine Matte Tone as the intensity of the frosted-glass effect.

At a fixed Background Opacity, changing Matte Tone should produce an immediately visible difference.

**Matte Tone = 0**
- Little or no background blur.
- Wallpaper and underlying windows remain relatively clear.
- The existing transparent/glossy look is preserved.
- Background tint and transparency are still controlled by Background Opacity.

**Matte Tone = 50**
- Moderate background blur.
- Background details become softened.
- Wallpaper colors remain visible.
- The popup begins to resemble frosted glass.

**Matte Tone = 100**
- Strong background blur.
- Background text, file icons, and window details become indistinct.
- The surface appears smoothly frosted, calm, and visually consistent.
- Colors behind the surface are softened and blended.
- The popup still retains a tasteful amount of background color and visual depth.

Interpolate smoothly between these states.

Matte Tone should primarily adjust background blur intensity and, where supported, the visual softness of the material through brightness, saturation, tint treatment, or similar effects.

It should **not** simply increase opacity or flatten a color gradient.

### Important Independence Requirement

At Background Opacity = 75%:

- Matte Tone = 0 should look like tinted transparent glass.
- Matte Tone = 100 should look like strongly frosted glass.

Both should maintain approximately the same background tint opacity.

The difference must be obvious.

At Background Opacity = 100%, the opaque tint may naturally conceal the blur. This is acceptable and should not be compensated for by unexpectedly changing opacity.

## 4. Implement Real Background Blur

This is the most important technical requirement.

Investigate the GNOME Shell version supported by this extension and use an appropriate native blur implementation.

Consider GNOME Shell's `Shell.BlurEffect` in `Shell.BlurMode.BACKGROUND`, where supported.

Refer to the GNOME Shell API and established GNOME extensions such as Blur My Shell for implementation patterns.

Requirements:

- Blur the actual desktop content behind the popup.
- Do not blur the popup's own content.
- Do not use `Shell.BlurMode.ACTOR` when the desired behavior is background blur.
- Avoid unsupported browser-style CSS properties such as `backdrop-filter` in GNOME Shell styles.
- Do not use a static screenshot of the wallpaper as a substitute for actual background blur.
- Ensure the blur covers the entire visible background surface.
- Respect rounded corners and prevent blur from leaking outside the popup.
- Keep background tinting separate from blur processing.
- Ensure the blur responds correctly when the popup opens, closes, moves, or changes size.
- Clean up effects, actors, and signal handlers when the extension is disabled or rebuilt.

Prefer a layered architecture:

1. **Backdrop blur layer:** Blurs content behind the popup.
2. **Theme tint layer:** Applies the selected theme's background color and user-selected opacity.
3. **Content layer:** Contains sharp text, icons, cards, graphs, and controls.

Additional layers for subtle borders, highlights, or noise are acceptable when useful and performant.

Verify the actual scene graph and rendering order so the effects work as intended.

If the target GNOME Shell version has limitations, implement the best supported solution and clearly explain the limitation rather than silently replacing blur with a gradient or transparency change.

## 5. Improve the Existing Color Themes

The extension already includes multiple user-selectable color themes.

I also want these themes to look more refined and harmonious.

Inspect all existing theme definitions and improve their palettes without removing themes or breaking existing preferences.

### General Visual Direction

Aim for a modern GNOME/macOS-inspired appearance:

- Sophisticated, slightly desaturated colors.
- Harmonious background and accent combinations.
- Soft surfaces rather than aggressively colored panels.
- Comfortable contrast and readable text.
- Subtle separation between the popup background and internal cards.
- Gentle borders and highlights.
- Consistent interaction states.
- Minimal visual clutter.

The goal is a premium desktop UI, not a highly saturated gaming-style interface.

### Theme-Specific Behavior

Preserve each theme's recognizable identity.

For example, an Ocean theme should retain its blue identity but use a balanced deep-blue palette, soft blue-gray surfaces, and restrained cyan accents.

Other themes should receive similarly coherent palettes based on their existing identities.

Avoid making every theme look identical.

### Theme Colors and Frosted Glass

Each theme should define appropriate colors for:

- Main popup tint
- Secondary surfaces and cards
- Text and secondary text
- Borders and dividers
- Selected controls
- Hover states
- Accent elements
- Active tab indicators

The frosted-glass system must work with all themes.

Do not hardcode blue, gray, or white as universal glass colors.

A theme should determine the tint, while Matte Tone determines the frosting intensity and Background Opacity determines tint transparency.

Ensure content stays readable against different wallpapers.

## 6. Improve Visual Depth

Use a restrained material design approach:

- A very subtle edge highlight on the main popup.
- Soft borders that separate surfaces without creating heavy outlines.
- Slight tonal contrast between the main surface and cards.
- Consistent corner radii.
- Optional extremely subtle texture or noise if supported efficiently.
- A soft shadow to distinguish the popup from the desktop.

Avoid exaggerated glass effects, glossy reflections, thick outlines, and strong gradients.

The preferred result is soft, matte, elegant, and understated.

## 7. Apply the Material Consistently

The new rendering system should apply to the entire expanded popup, regardless of the selected tab.

This includes:

- System
- Calendar
- Weather
- Other extension tabs
- Bottom navigation bar

The popup should appear as one coherent material.

Internal cards can have slightly different background tones, but should not independently blur the desktop unless there is a specific design reason.

Preserve all existing layouts, content, graphs, icons, and interactions.

Do not redesign unrelated UI components.

## 8. Live Settings Updates

Both settings should update the visible popup immediately.

Changing Matte Tone must update the actual blur intensity, rather than only updating stored preferences.

Changing Background Opacity must update the tint without changing the sharpness of the content.

Avoid recreating the entire popup or interrupting active interactions when a setting changes.

Preserve the existing settings controls and persistence mechanism.

Ensure changes continue working after the extension is restarted.

## 9. Performance and Compatibility

Background blur can be computationally expensive, so optimize carefully.

- Avoid unnecessary effect instances.
- Prefer a single reusable backdrop blur layer.
- Avoid repeatedly rebuilding shaders or actors.
- Update effects only when relevant properties change.
- Avoid expensive blur processing when the popup is hidden.
- Handle high-DPI displays and different scaling factors.
- Prevent graphical artifacts during animations.
- Preserve responsiveness when switching tabs.
- Avoid memory leaks.
- Maintain compatibility with the GNOME Shell versions declared by the extension.

Do not introduce a dependency on another installed extension, such as Blur My Shell.

The feature should work independently.

## 10. Verification and Testing

Do not consider the implementation complete just because the settings values change.

Verify the actual rendered appearance.

### Required Test A — Matte Tone

Set Background Opacity to 75%.

Compare Matte Tone at:

- 0
- 25
- 50
- 75
- 100

There must be a clearly observable, progressively stronger frosted-glass effect.

### Required Test B — Opacity

Set Matte Tone to 75%.

Compare Background Opacity at:

- 25
- 50
- 75
- 100

Opacity should change the strength of the background tint without making popup content transparent or inadvertently changing blur intensity.

### Required Test C — Desktop Backgrounds

Test against:

- A bright, colorful wallpaper.
- A dark wallpaper.
- A desktop with several open windows.
- A window containing readable text or distinct icons immediately behind the popup.

At high Matte Tone values, the underlying objects should be visibly softened and no longer clearly readable.

### Required Test D — Themes

Verify the effect with every existing color theme.

Test text contrast, card backgrounds, borders, navigation icons, and hover/selection states.

### Required Test E — Runtime

Verify theme switching, popup resizing, opening and closing, and extension disable/re-enable behavior.

If live visual testing is unavailable, explain what could be verified programmatically and what requires manual testing. Do not claim the effect has been visually verified without observing it.

## 11. Implementation Expectations

Before modifying code:

1. Locate the existing theme definitions and appearance settings.
2. Identify how Background Opacity and Matte Tone currently affect rendering.
3. Determine why Matte Tone produces little or no visible difference.
4. Inspect the popup's actor hierarchy and its background/content layers.
5. Identify the appropriate native blur implementation for the supported GNOME Shell versions.

Then implement the changes using the existing architecture wherever possible.

Avoid unrelated refactoring.

After implementation, summarize:

- The root cause of the previous Matte Tone behavior.
- How the new background blur works.
- How the two settings are now separated.
- Which theme colors were refined.
- Any compatibility or performance limitations.
- What was actually tested.

## Final Goal

I want the extension to have a beautiful, polished, theme-aware appearance inspired by macOS translucent widgets.

**At Matte Tone = 100 and Background Opacity = 75, the popup should look like a genuinely frosted glass panel, not a transparent colored box.**

The difference between Matte Tone = 0 and Matte Tone = 100 should be substantial and immediately recognizable.

Prioritize real rendering improvements, readability, theme harmony, and performance over decorative styling.
