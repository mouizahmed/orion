import { globalShortcut, screen } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { app } from 'electron'
import { getWindow } from './window'

const isMac = process.platform === 'darwin'
const EDGE_INSET = 8

type MovementAction = 'moveUp' | 'moveDown' | 'moveLeft' | 'moveRight'
type OverlayPanelAction = 'toggleNotepad' | 'toggleTranscript' | 'toggleAsk' | 'toggleInsights'
type ShortcutAction = MovementAction | 'toggleVisibility' | 'focusNotepad' | OverlayPanelAction
type ShortcutUpdatePayload = {
  action: ShortcutAction
  shortcut: string | null
}

const shortcutActions: ShortcutAction[] = [
  'moveUp',
  'moveDown',
  'moveLeft',
  'moveRight',
  'toggleVisibility',
  'focusNotepad',
  'toggleNotepad',
  'toggleTranscript',
  'toggleAsk',
  'toggleInsights',
]

const defaultShortcuts: Record<ShortcutAction, string> = {
  moveUp: isMac ? 'Cmd+Up' : 'Ctrl+Up',
  moveDown: isMac ? 'Cmd+Down' : 'Ctrl+Down',
  moveLeft: isMac ? 'Cmd+Left' : 'Ctrl+Left',
  moveRight: isMac ? 'Cmd+Right' : 'Ctrl+Right',
  toggleVisibility: isMac ? 'Cmd+Space' : 'Ctrl+Space',
  focusNotepad: isMac ? 'Cmd+Alt+N' : 'Ctrl+Alt+N',
  toggleNotepad: isMac ? 'Cmd+Alt+1' : 'Ctrl+Alt+1',
  toggleTranscript: isMac ? 'Cmd+Alt+2' : 'Ctrl+Alt+2',
  toggleAsk: isMac ? 'Cmd+Alt+3' : 'Ctrl+Alt+3',
  toggleInsights: isMac ? 'Cmd+Alt+4' : 'Ctrl+Alt+4',
}

function storageFilePath(fileName: string) {
  const appData = app.getPath('userData')
  return path.join(appData, fileName)
}

const shortcutsFilePath = storageFilePath('shortcuts.json')

function readPersistedShortcuts() {
  try {
    const raw = fs.readFileSync(shortcutsFilePath, 'utf-8')
    const parsed = JSON.parse(raw) as Partial<Record<ShortcutAction, string>>
    return parsed
  } catch (error) {
    if (
      error instanceof Error &&
      'code' in error &&
      (error as NodeJS.ErrnoException).code === 'ENOENT'
    ) {
      return {}
    }

    console.error('Failed to read persisted shortcuts:', error)
    return {}
  }
}

function writePersistedShortcuts(values: Record<ShortcutAction, string>) {
  try {
    fs.mkdirSync(path.dirname(shortcutsFilePath), { recursive: true })
    fs.writeFileSync(shortcutsFilePath, JSON.stringify(values, null, 2), 'utf-8')
  } catch (error) {
    console.error('Failed to write shortcuts configuration:', error)
  }
}

const persistedShortcuts = readPersistedShortcuts()

let shortcuts: Record<ShortcutAction, string> = {
  ...defaultShortcuts,
  ...Object.fromEntries(
    Object.entries(persistedShortcuts).filter(
      (entry): entry is [ShortcutAction, string] =>
        shortcutActions.includes(entry[0] as ShortcutAction),
    ),
  ),
}

type VisibleOverlayBounds = {
  offsetX: number
  offsetY: number
  width: number
  height: number
}

let visibleOverlayBounds: VisibleOverlayBounds | null = null

export function setVisibleOverlayBounds(bounds: VisibleOverlayBounds | null) {
  visibleOverlayBounds =
    bounds &&
    Number.isFinite(bounds.offsetX) &&
    Number.isFinite(bounds.offsetY) &&
    Number.isFinite(bounds.width) &&
    Number.isFinite(bounds.height)
      ? {
          offsetX: Math.round(bounds.offsetX),
          offsetY: Math.round(bounds.offsetY),
          width: Math.max(1, Math.round(bounds.width)),
          height: Math.max(1, Math.round(bounds.height)),
        }
      : null
}

function getHorizontalClampBounds(winWidth: number) {
  const offsetX = visibleOverlayBounds?.offsetX ?? 0
  const width = Math.min(winWidth, visibleOverlayBounds?.width ?? winWidth)
  return { offsetX, width }
}

function getVerticalClampBounds(winHeight: number) {
  const offsetY = visibleOverlayBounds?.offsetY ?? 0
  const height = Math.min(winHeight, visibleOverlayBounds?.height ?? winHeight)
  return { offsetY, height }
}

function clamp(value: number, min: number, max: number) {
  if (max < min) return min
  return Math.min(max, Math.max(min, value))
}

export function getShortcutState() {
  return {
    current: { ...shortcuts },
    defaults: { ...defaultShortcuts },
  }
}

const movementActions = {
  moveUp: () => {
    const win = getWindow()
    if (!win || !win.isVisible()) return
    const [currentX, currentY] = win.getPosition()
    const currentDisplay = screen.getDisplayNearestPoint({ x: currentX, y: currentY })
    const moveIncrement = Math.floor(
      Math.min(currentDisplay.workAreaSize.width, currentDisplay.workAreaSize.height) * 0.1,
    )
    const [, winHeight] = win.getSize()
    const { offsetY, height } = getVerticalClampBounds(winHeight)
    const minY = currentDisplay.workArea.y + EDGE_INSET - offsetY
    const maxY = currentDisplay.workArea.y + currentDisplay.workArea.height - offsetY - height - EDGE_INSET
    win.setPosition(currentX, clamp(currentY - moveIncrement, minY, maxY))
  },
  moveDown: () => {
    const win = getWindow()
    if (!win || !win.isVisible()) return
    const [currentX, currentY] = win.getPosition()
    const currentDisplay = screen.getDisplayNearestPoint({ x: currentX, y: currentY })
    const moveIncrement = Math.floor(
      Math.min(currentDisplay.workAreaSize.width, currentDisplay.workAreaSize.height) * 0.1,
    )
    const [, winHeight] = win.getSize()
    const { offsetY, height } = getVerticalClampBounds(winHeight)
    const minY = currentDisplay.workArea.y + EDGE_INSET - offsetY
    const maxY = currentDisplay.workArea.y + currentDisplay.workArea.height - offsetY - height - EDGE_INSET
    win.setPosition(currentX, clamp(currentY + moveIncrement, minY, maxY))
  },
  moveLeft: () => {
    const win = getWindow()
    if (!win || !win.isVisible()) return
    const [currentX, currentY] = win.getPosition()
    const currentDisplay = screen.getDisplayNearestPoint({ x: currentX, y: currentY })
    const moveIncrement = Math.floor(
      Math.min(currentDisplay.workAreaSize.width, currentDisplay.workAreaSize.height) * 0.1,
    )
    const [winWidth] = win.getSize()
    const { offsetX, width } = getHorizontalClampBounds(winWidth)
    const minX = currentDisplay.workArea.x + EDGE_INSET - offsetX
    const maxX = currentDisplay.workArea.x + currentDisplay.workArea.width - offsetX - width - EDGE_INSET
    win.setPosition(clamp(currentX - moveIncrement, minX, maxX), currentY)
  },
  moveRight: () => {
    const win = getWindow()
    if (!win || !win.isVisible()) return
    const [currentX, currentY] = win.getPosition()
    const currentDisplay = screen.getDisplayNearestPoint({ x: currentX, y: currentY })
    const moveIncrement = Math.floor(
      Math.min(currentDisplay.workAreaSize.width, currentDisplay.workAreaSize.height) * 0.1,
    )
    const [winWidth] = win.getSize()
    const { offsetX, width } = getHorizontalClampBounds(winWidth)
    const minX = currentDisplay.workArea.x + EDGE_INSET - offsetX
    const maxX = currentDisplay.workArea.x + currentDisplay.workArea.width - offsetX - width - EDGE_INSET
    win.setPosition(clamp(currentX + moveIncrement, minX, maxX), currentY)
  },
}

let activeShortcutRegistration: {
  toggleVisibilityHandler: () => void
  focusNotepadHandler?: () => void
  overlayPanelHandlers?: Partial<Record<OverlayPanelAction, () => void>>
} | null = null

export function registerMovementShortcuts() {
  Object.keys(movementActions).forEach((action) => {
    const keybind = shortcuts[action as keyof typeof shortcuts]
    if (keybind) {
      try {
        globalShortcut.register(keybind, movementActions[action as keyof typeof movementActions])
        console.log(`Registered ${action}: ${keybind}`)
      } catch (error) {
        console.error(`Failed to register ${action} (${keybind}):`, error)
      }
    }
  })
}

export function unregisterMovementShortcuts() {
  Object.keys(movementActions).forEach((action) => {
    const keybind = shortcuts[action as keyof typeof shortcuts]
    if (keybind && globalShortcut.isRegistered(keybind)) {
      globalShortcut.unregister(keybind)
      console.log(`Unregistered ${action}: ${keybind}`)
    }
  })
}

export function registerKeyboardShortcuts(
  toggleVisibilityHandler: () => void,
  focusNotepadHandler?: () => void,
  overlayPanelHandlers?: Partial<Record<OverlayPanelAction, () => void>>,
) {
  const win = getWindow()
  if (!win) return

  activeShortcutRegistration = {
    toggleVisibilityHandler,
    focusNotepadHandler,
    overlayPanelHandlers,
  }

  // Unregister all existing shortcuts first
  globalShortcut.unregisterAll()

  // Register movement shortcuts (window is visible by default)
  registerMovementShortcuts()

  // Register toggle visibility shortcut (always active)
  if (shortcuts.toggleVisibility) {
    try {
      globalShortcut.register(shortcuts.toggleVisibility, toggleVisibilityHandler)
      console.log(`Registered toggleVisibility: ${shortcuts.toggleVisibility}`)
    } catch (error) {
      console.error(`Failed to register toggleVisibility (${shortcuts.toggleVisibility}):`, error)
    }
  }

  if (shortcuts.focusNotepad && focusNotepadHandler) {
    try {
      globalShortcut.register(shortcuts.focusNotepad, focusNotepadHandler)
      console.log(`Registered focusNotepad: ${shortcuts.focusNotepad}`)
    } catch (error) {
      console.error(`Failed to register focusNotepad (${shortcuts.focusNotepad}):`, error)
    }
  }

  const overlayPanelActions: OverlayPanelAction[] = ['toggleNotepad', 'toggleTranscript', 'toggleAsk', 'toggleInsights']
  overlayPanelActions.forEach((action) => {
    const keybind = shortcuts[action]
    const handler = overlayPanelHandlers?.[action]
    if (!keybind || !handler) return

    try {
      globalShortcut.register(keybind, handler)
      console.log(`Registered ${action}: ${keybind}`)
    } catch (error) {
      console.error(`Failed to register ${action} (${keybind}):`, error)
    }
  })
}

export function unregisterKeyboardShortcuts() {
  globalShortcut.unregisterAll()
}

export function restoreKeyboardShortcuts() {
  if (!activeShortcutRegistration) return
  registerKeyboardShortcuts(
    activeShortcutRegistration.toggleVisibilityHandler,
    activeShortcutRegistration.focusNotepadHandler,
    activeShortcutRegistration.overlayPanelHandlers,
  )
}

export function updateShortcut(payload: ShortcutUpdatePayload) {
  const { action, shortcut } = payload

  if (!action) {
    throw new Error('Shortcut action is required')
  }

  if (!(action in shortcuts)) {
    throw new Error(`Unsupported shortcut action: ${action}`)
  }

  const targetDefault = defaultShortcuts[action]
  const nextShortcut = (shortcut ?? targetDefault).trim()

  if (!nextShortcut) {
    throw new Error('Shortcut value cannot be empty')
  }

  const previousShortcut = shortcuts[action]

  if (previousShortcut === nextShortcut) {
    return getShortcutState()
  }

  shortcuts = {
    ...shortcuts,
    [action]: nextShortcut,
  }

  const win = getWindow()
  const windowVisible = Boolean(win?.isVisible())
  const shouldValidate =
    action === 'toggleVisibility' ||
    action === 'focusNotepad' ||
    action === 'toggleNotepad' ||
    action === 'toggleTranscript' ||
    action === 'toggleAsk' ||
    action === 'toggleInsights' ||
    windowVisible

  if (shouldValidate) {
    const isRegistered = globalShortcut.isRegistered(nextShortcut)

    if (!isRegistered) {
      shortcuts = {
        ...shortcuts,
        [action]: previousShortcut,
      }
      throw new Error(`Failed to register shortcut: ${nextShortcut}`)
    }
  }

  const nextState = getShortcutState()
  writePersistedShortcuts(nextState.current)

  return nextState
}
