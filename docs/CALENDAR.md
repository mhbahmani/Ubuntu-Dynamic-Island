# Calendar prototype

Google Calendar event integration is planned separately in
[GOOGLE_CALENDAR_PLAN.md](GOOGLE_CALENDAR_PLAN.md). The behavior below describes
the current date browser; account integration is not implemented yet.

Enable Calendar in **Preferences → Modules**, or open Calendar in `make preview`
without installing. **Preferences → Calendar** contains the month-grid choices;
the settings button in the Calendar tab opens that page directly.

Choose **Main calendar**: Jalali (شمسی), Gregorian (میلادی), or Hijri (قمری).
Additional date switches show the other calendars below the main date in the
header. Changes apply live and preserve selection. Earlier Both/Jalali/Gregorian
preferences migrate to the new settings without overwriting newer choices.

The grid always shows one number per day. Jalali and Hijri run right-to-left from
Saturday; Gregorian runs left-to-right from Monday. Only the four, five or six
weeks needed by the month are shown. Cells outside the current month are empty
and cannot receive clicks or focus. Only today's actual civil date has a red fill;
another selected date uses a neutral outline. Month arrows browse without moving
the selection to the same day number in the new month. When the selection is
offscreen, the heading shows the browsed month/year and hides offscreen details.
Today returns to and selects the current date.
The selected day/month/year replaces the month-only heading, with additional dates
on a smaller second line. Month arrows and Today form one grouped control beside
the date. There is no copy button or bottom date row. The header and navigation
stay outside scrolling. Common layouts fit without scrolling. Larger text or small displays
can scroll the month without hiding its controls; keyboard focus reveals dates.

Tab enters the selected day. Arrows move by day/week, Home/End moves within the
week, Page Up/Down changes month and Shift+Page Up/Down changes year. Month changes
clamp keyboard date movement to the target month's length. Month controls remain
at a fixed position as date/holiday details appear or disappear.

## Date in the notch

Enable **Preferences → Notch → Dates in the notch → Show date in notch**.
Dates default off and work independently of the Calendar module. Keep **Follow
main calendar** for one date matching the grid, or turn it off and enable any
combination of Jalali, Gregorian and Hijri. The row order is their left-to-right
order in the notch; use each row's up/down buttons to move it. Move **Dates** in
**Notch order** to position the whole group among other indicators.

Expand a calendar's row to choose a format preset, a custom pattern, or **Numerals**
(calendar default, Persian, Latin). The default is `%d %mm`, such as `۱۹ آبان` or
`10 Nov`. Custom patterns preview as you type; press Apply to save. Invalid or
unfinished patterns keep the previously saved notch text. Empty calendar
selection hides the group and shows guidance in settings. Settings changes apply
immediately; they do not change the month grid or its holiday rules.

The date codes match those documented by the installed Persian Calendar extension;
the implementation uses this project's ICU model. **Format codes** in preferences
lists the codes. Ordinary text and separators are literal, not markup or code.

| Code | Meaning |
| --- | --- |
| `%Y`, `%y` | Four-digit / two-digit year |
| `%MM`, `%mm` | Full / short month name |
| `%M`, `%m` | Padded / unpadded month number |
| `%D`, `%d` | Padded / unpadded day number |
| `%WW`, `%ww`, `%w` | Full / short / one-letter weekday |
| `%%` | Literal percent sign |

For example, `%Y/%M/%D` gives `۱۴۰۵/۰۸/۱۹` in Jalali; `%ww %d %mm` gives
`Tue 10 Nov` in Gregorian. Month and weekday names follow the calendar's language;
the numeral option changes digits independently. Patterns are one line and bounded
to keep the top bar usable. Long dates share a measured width budget and ellipsize;
hovering over the dates or focusing the notch shows the full formatted values.
Separate actors preserve Persian/English direction and the chosen calendar order.
Accessible names also include the calendar and full date/year. Hijri remains
calculated, as in the tab. Older single-calendar settings migrate once without
overwriting an existing multi-calendar selection.

The visible notch listens to GNOME's existing clock and timezone notifications,
updating only when the local civil day changes. It adds no timer. Expansion,
hiding, turning the date off and destroying the notch disconnect the signals;
showing it again refreshes the date immediately.

## Holiday markings

Holiday rules follow **Main calendar**; additional date displays do not change
them. Weekend headings and holiday numbers use a warm accent, with no line or
decoration through the number. Selecting a named occasion shows its name in the header.
Screen readers receive the holiday name or weekend label. Ordinary dates and
weekly weekends do not add a header line or increase the normal tab height.

- **Jalali:** Iranian solar and religious holidays, plus Fridays. Lunar dates for
  Jalali year 1405 follow the [official University of Tehran calendar](https://calendar.ut.ac.ir/documents/2139738/7092644/Calendar-1405.pdf/64228cbb-f4de-dc32-4d2b-57db3c8e322f?t=1761972997587),
  including overlapping occasions and both occurrences of Eid al-Fitr. Other
  years use recurring solar rules and calculated lunar estimates.
- **Hijri:** the Iranian Islamic holiday set on the displayed tabular calendar,
  plus Fridays. These are labeled **محاسبه‌ای** (calculated); they are not a
  universal holiday schedule or a prediction of local moon-sighting announcements.
- **Gregorian:** Saturday/Sunday weekends only. No country-specific public
  holiday set was selected.

The 1405 table contains published annual holidays, not emergency or later-declared
closures. Estimated lunar holidays are visibly labeled; the fixed solar rules are
recurrences, not a historical record of when each holiday was first introduced.
Holiday data is bundled under `services/`; no network request or polling is added.

## Calculation and scope

Conversion uses GJS's built-in ICU through `Intl.DateTimeFormat` with UTC civil-day
arithmetic, so DST does not skip dates. Today uses the desktop's local date.
Hijri uses the explicit `islamic-civil` tabular calculation described by
[Unicode ICU](https://unicode-org.github.io/icu-docs/apidoc/released/icu4j/com/ibm/icu/util/IslamicCalendar.CalculationType.html).
It is a calculated date browser, not a local moon-sighting calendar; see the
[US Naval Observatory explanation](https://aa.usno.navy.mil/data/islamic_observances).
This difference is stated in preferences. No claims of parity with Iranian
observational dates or religious holiday announcements are made.

The design draws on month browsing, Saturday-first weeks, multiple date formats,
and Today in the installed
[Persian Calendar extension](https://github.com/omid/Persian-Calendar-for-Gnome-Shell).
Its code and event datasets were not copied. Persian text across the island and
preferences prefers Vazir, then Vazirmatn, then DejaVu Sans; Latin text retains
Noto Sans. The user's existing Vazirmatn installation is used on this machine.
No fonts are installed/bundled. Isolated previews copy any installed Vazir or
Vazirmatn faces into their temporary font directory to reproduce the real layout.

There are no accounts, requests, event stores or polling loops. The tab refreshes
Today on opening and schedules one midnight update only while visible. Hiding or
destroying it releases the timer. Physical suspend/resume and changing the system
clock/time zone while the tab remains open are not validated; reopening refreshes
the local date. Appointments, reminders and account sync remain outside
this prototype. It does not modify another installed calendar extension.

## Validation

```sh
node --test tests/calendar.test.mjs
node --test tests/calendar-holidays.test.mjs
make prefs-test
make preview-headless PREVIEW_ARGS="--tab calendar --check-calendar --size 1600x1000 --duration 44"
make preview PREVIEW_ARGS="--tab calendar --card-width 380 --text-scale 1.5"
make preview PREVIEW_ARGS="--tab calendar --card-width 380 --text-scale 1.5 --calendar-date 2026-06-04"
node --test tests/install.test.mjs
make build
```

Calendar checks cover preferences, migration, selection preservation, Nowruz,
Hijri year/month boundaries, 29/30-day months, compact week counts, both keyboard
directions, selected-date headings, holidays, blank adjacent-month cells, Today,
narrow/default widths, scale changes, enlarged text and
hidden cleanup. Notch checks cover all calendars, following the main calendar,
independent selection, order, accessible dates, simulated day changes, actual
Persian glyph fonts, and clock signal cleanup. Also inspect an actual windowed 200% preview: changing the headless
theme scale alone does not reproduce native text scaling. Preview settings are
isolated from the host. Root-module and `services/` copy rules automatically
include the view, preferences and model in installation, packaging and previews.
