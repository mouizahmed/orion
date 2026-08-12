import { dialog } from 'electron'
import { ipcMain } from 'electron'
import path from 'node:path'
import fs from 'node:fs'
import { getWindow, isKnownRendererSender } from './window'
import { isRendererAuthenticated } from './auth-handlers'

// Only these exact formats are allowed
const imageMimeTypes: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.png': 'image/png',
}

const documentMimeTypes: Record<string, string> = {
  '.pdf': 'application/pdf',
}

type PickedAttachment = {
  kind: 'image' | 'file'
  mimeType: string
  name: string
  size: number
  filePath: string
  dataUrl?: string
}

export function setupAttachmentHandlers() {
  ipcMain.handle('attachments:pick', async (event) => {
    if (!isKnownRendererSender(event.sender) || !isRendererAuthenticated()) {
      throw new Error('Unauthorized IPC sender')
    }
    const win = getWindow()
    if (!win) {
      throw new Error('Main window is not available')
    }

    const { canceled, filePaths } = await dialog.showOpenDialog(win, {
      title: 'Select attachments',
      buttonLabel: 'Attach',
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: 'Supported Files', extensions: ['jpg', 'jpeg', 'gif', 'png', 'pdf'] },
        { name: 'Images', extensions: ['jpg', 'jpeg', 'gif', 'png'] },
        { name: 'PDF', extensions: ['pdf'] },
      ],
    })

    if (canceled || filePaths.length === 0) {
      return []
    }

    const unsupportedFiles: string[] = []

    const results = await Promise.allSettled<PickedAttachment | null>(
      filePaths.map(async (filePath) => {
        const extension = path.extname(filePath).toLowerCase()
        const imageMimeType = imageMimeTypes[extension]
        const documentMimeType = documentMimeTypes[extension]
        const mimeType = imageMimeType ?? documentMimeType

        // Check if file type is supported
        if (!mimeType) {
          unsupportedFiles.push(`${path.basename(filePath)} (${extension})`)
          return null
        }

        const isImage = Boolean(imageMimeType)
        const stats = await fs.promises.stat(filePath)
        const fileBuffer = await fs.promises.readFile(filePath)
        const base64 = fileBuffer.toString('base64')
        const dataUrl = `data:${mimeType};base64,${base64}`

        return {
          kind: isImage ? 'image' : 'file',
          mimeType,
          name: path.basename(filePath),
          size: stats.size,
          filePath,
          dataUrl,
        } satisfies PickedAttachment
      }),
    )

    // Show error dialog if there are unsupported files
    if (unsupportedFiles.length > 0) {
      const fileList = unsupportedFiles.join('\n')

      dialog.showErrorBox(
        'Unsupported File Type',
        `The following files are not supported:\n\n${fileList}\n\nOnly these formats are supported:\n• JPEG (.jpg, .jpeg)\n• GIF (.gif)\n• PNG (.png)\n• PDF (.pdf)`,
      )
    }

    return results
      .map((result) => {
        if (result.status !== 'fulfilled') {
          console.error('Failed to load attachment', result.reason)
          return null
        }

        return result.value
      })
      .filter((value): value is PickedAttachment => Boolean(value))
  })
}

