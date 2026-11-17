# Settings and modules

Open the island and select the gear, or run `gnome-extensions prefs ubuntu-island@mhbahmani.github.io`. The Calendar module switch takes effect immediately. After changing other module switches, disable and re-enable Ubuntu Island in GNOME Extensions.

## Notch and controls

In **Preferences → Notch**, drag indicators into order or use the move buttons. Choose how the music title fits, configure dates and time, and select which metrics appear while collapsed. Appearance settings control the theme, tint, blur and panel size. Auto-hide reveals the notch when the pointer rests at the top edge.

**Super+Alt+I** opens and closes the island. Inside it, **Ctrl+Tab** and **Ctrl+Shift+Tab** cycle tabs. The Media tab controls desktop players through MPRIS. Sound lets you choose an output and switch compatible Bluetooth headsets between high-quality music and microphone modes.

Open **Lyrics** to look up the current title and artist on LRCLIB. The request includes the album and track length when available. Closing the view cancels the lookup. **Up next** shows the queue for players that publish an MPRIS track list.

## Calendar

Choose Gregorian, Jalali or Hijri as the main calendar. The main calendar determines the week layout and holiday colors. Use the notch settings to add dates from the other calendars. Published Iranian dates cover Jalali year 1405. Outside that year, calculated lunar holidays can differ from local observations.

For desktop events, connect an account in **Ubuntu Settings → Online Accounts** and verify it in GNOME Calendar. Under **Preferences → Calendar → Events**, enable desktop events and select the calendars to show. Ubuntu Island reads the selected calendars through Evolution Data Server. GNOME manages sign-in and synchronization. Date browsing also works without the optional event bindings.

Enable **Notch → Upcoming event** to see the next meeting. Event titles in the notch are optional. Selecting a day in the expanded calendar shows that day's agenda.

## Weather and commute

Choose a weather location by city search or coordinates. Forecast requests send the saved coordinates to the chosen provider. Open-Meteo, MET Norway and wttr.in offer keyless forecasts. The Weather tab shows the active source and marks cached results when stale.

In **Preferences → Commute**, add a driving route and choose a provider and any backups. Each provider used receives the route endpoints. The map uses OpenStreetMap tiles and explicit searches use Nominatim. Starting from your current location requires GeoClue permission. If a fix fails, you can choose the saved start.

Balad offers keyless routing with unverified traffic freshness. Mapbox and Neshan support traffic estimates using your own key. Other providers can return baseline travel times. **Validate & save** checks a key using public landmarks and stores it in the desktop keyring. The tab names the provider that supplied the estimate.

## Notifications

The Notifications tab mirrors GNOME's message tray. Dismissing a notification or clearing the list also removes it from GNOME. Do Not Disturb changes the desktop banner setting. Choose compact or grouped rows, and enable the unseen count or notch peeks separately.

## Agents

Enable the Agents module to use Quick Ask with Claude Code, Codex or OpenCode. Select the installed CLI, terminal and working directory in preferences. A Quick Ask shortcut can open the composer directly.

To track sessions, select **Preferences → Agents → Enable integration** and review the configuration changes. Setup backs up the affected configuration and adds the provider's hooks or plugin. Restart the CLI after setup. For Codex, review trust in `/hooks`. **Remove integration** removes the Island entries. Session tracking passes status and identity metadata over a private local socket. Optional notifications and notch counts are individually configurable.
