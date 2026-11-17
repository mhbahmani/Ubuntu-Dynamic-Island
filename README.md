# Ubuntu Island

Music, system activity and your next appointment in a notch at the top of your Ubuntu desktop. Click it to open a panel with playback controls, device settings and the tabs you choose.

**Ubuntu 24.04** · **GNOME Shell 46** · **Wayland**

https://github.com/user-attachments/assets/0d6e1b67-579b-4400-afae-7a3b5dbe287e

## Install

Run the **recommended GitHub installer** from your desktop account to install or update to the latest release. The installer backs up the previous version and requests administrator authentication only for missing Calendar packages.

```sh
curl -fsSL https://raw.githubusercontent.com/mhbahmani/Ubuntu-Dynamic-Island/master/scripts/install.sh | sh
```

To install the development version from `master`, replace `| sh` with `| sh -s -- --dev`.

<details>
<summary>Install from a local checkout</summary>

```sh
git clone https://github.com/mhbahmani/Ubuntu-Dynamic-Island.git
cd Ubuntu-Dynamic-Island
make install
```

To update your clone, run `git pull --ff-only` and `make install`.

</details>

**Log out and back in**, then enable the extension.

```sh
gnome-extensions enable ubuntu-island@mhbahmani.github.io
```

## Make it yours

- **Open the island** with a click or **Super+Alt+I**. Switch tabs with **Ctrl+Tab** and close with **Escape**.
- **Arrange the notch** in **Preferences → Notch**. Put the track title, CPU meter, bandwidth, weather or upcoming event where you want it.
- **Choose your tabs** in **Preferences → Modules**. Music, System, Sound and Bluetooth start enabled. Add Weather, Commute, Calendar, Notifications or Agents when you need them.

[Settings and module setup](docs/GUIDE.md) · [Development and preview](docs/DEVELOPMENT.md) · [Design inspiration](https://github.com/Gakuseei/Ricelin)
