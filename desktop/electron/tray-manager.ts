import { Tray, Menu, app, nativeImage } from "electron";
import path from "node:path";
import { showWindow, restartApp, setQuitting } from "./window-manager";

let tray: Tray | null;

const getAppName = () => app.getName() || "Orionly";
const getAppVersion = () => `v${app.getVersion()}`;

export function createTray() {
  let iconPath;
  const iconName = process.platform === "darwin" ? "icon-macos.png" : "icon.png";

  if (app.isPackaged) {
    iconPath = path.join(process.resourcesPath, "build", iconName);
  } else {
    iconPath = path.join(
      process.env.APP_ROOT || path.join(__dirname, ".."),
      "build",
      iconName,
    );
  }

  try {
    // Create native image and resize for platform-specific requirements
    let icon = nativeImage.createFromPath(iconPath);

    // Platform-specific icon sizing
    if (process.platform === "darwin") {
      // macOS menu bar icons should be 16x16 or 22x22
      icon = icon.resize({ width: 22, height: 22 });
      icon.setTemplateImage(true);
    } else if (process.platform === "win32") {
      // Windows tray icons should be 16x16 or 32x32
      icon = icon.resize({ width: 16, height: 16 });
    }

    tray = new Tray(icon);

    // Set tooltip (Windows/Linux - macOS doesn't show tooltips in menu bar)
    if (process.platform !== "darwin") {
      tray.setToolTip(getAppName());
    }

    const contextMenu = Menu.buildFromTemplate([
      {
        label: `Open ${getAppName()}`,
        click: showWindow,
      },
      { type: "separator" },
      {
        label: `${getAppName()} ${getAppVersion()}`,
        enabled: false,
      },
      { type: "separator" },
      {
        label: `Restart ${getAppName()}`,
        click: restartApp,
      },
      {
        label: `Quit ${getAppName()}`,
        click: () => {
          setQuitting(true);
          app.quit();
        },
      },
    ]);

    tray.setContextMenu(contextMenu);

    // Windows/Linux: double click to show window (macOS handles clicks automatically)
    if (process.platform !== "darwin") {
      tray.on("double-click", showWindow);
    }
  } catch (error) {
    console.error("Failed to create system tray:", error);
  }
}

export function cleanupTray() {
  if (tray && !tray.isDestroyed()) {
    tray.destroy();
  }
}
