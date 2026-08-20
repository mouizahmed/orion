import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { ChevronDown, ChevronRight, Folder, FolderOpen, Lock, Plus } from 'lucide-react'

import type { FolderRecord } from '@/features/notes/folder-types'

type FolderNode = FolderRecord & {
  children?: FolderNode[]
  access_mode?: 'workspace' | 'invite_only'
}

type FolderTreeItemProps = {
  folder: FolderNode
  level: number
  activeFolderId?: string
  onFolderClick: (folderId: string) => void
  onToggleExpand: (folderId: string) => void
  folderExpansions: Record<string, boolean>
}

function FolderTreeItem({
  folder,
  level,
  activeFolderId,
  onFolderClick,
  onToggleExpand,
  folderExpansions,
}: FolderTreeItemProps) {
  const hasChildren = folder.children && folder.children.length > 0
  const isActive = activeFolderId === folder.id
  const isExpanded = folderExpansions[folder.id] ?? false

  return (
    <div>
      <div
        style={{
          paddingLeft: `${level * 8}px`,
        }}
      >
        <Button
          type="button"
          variant="ghost"
          className={`w-full justify-start gap-1 py-1 px-2 text-xs h-7 hover:bg-violet-100/30 dark:hover:bg-violet-900/20 ${
            isActive ? 'bg-violet-200/40 dark:bg-violet-800/30' : ''
          }`}
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
          onClick={() => onFolderClick(folder.id)}
        >
          {hasChildren && (
            <div
              onClick={(e) => {
                e.stopPropagation()
                onToggleExpand(folder.id)
              }}
              className="flex items-center justify-center w-4 h-4 hover:bg-neutral-200 dark:hover:bg-neutral-600 rounded cursor-pointer"
            >
              {isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            </div>
          )}
          {!hasChildren && <div className="w-4" />}

          {isExpanded && hasChildren ? (
            <FolderOpen size={14} className="text-violet-600 dark:text-violet-400" />
          ) : (
            <Folder size={14} className="text-violet-600 dark:text-violet-400" />
          )}

          <span className="truncate">{folder.name}</span>

          {folder.access_mode === 'invite_only' && (
            <Lock
              size={10}
              className="text-neutral-400 dark:text-neutral-500 ml-auto flex-shrink-0"
            />
          )}
        </Button>
      </div>

      {hasChildren && isExpanded && (
        <div>
          {folder.children!.map((child) => (
            <FolderTreeItem
              key={child.id}
              folder={child}
              level={level + 1}
              activeFolderId={activeFolderId}
              onFolderClick={onFolderClick}
              onToggleExpand={onToggleExpand}
              folderExpansions={folderExpansions}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function FolderTreeView({
  folders,
  activeFolderId,
  onFolderClick,
  onToggleExpand,
  folderExpansions,
}: {
  folders: FolderNode[]
  activeFolderId?: string
  onFolderClick: (folderId: string) => void
  onToggleExpand: (folderId: string) => void
  folderExpansions: Record<string, boolean>
}) {
  return (
    <div className="space-y-0.5 min-w-fit">
      {folders.map((folder) => (
        <FolderTreeItem
          key={folder.id}
          folder={folder}
          level={0}
          activeFolderId={activeFolderId}
          onFolderClick={onFolderClick}
          onToggleExpand={onToggleExpand}
          folderExpansions={folderExpansions}
        />
      ))}
    </div>
  )
}

export function FolderTree({
  folders,
  isLoading,
  error,
  activeFolderId,
  onFolderClick,
  onCreateFolder,
}: {
  folders: FolderRecord[]
  isLoading?: boolean
  error?: string | null
  activeFolderId?: string
  onFolderClick: (folderId: string) => void
  onCreateFolder: () => void
}) {
  const [foldersExpanded, setFoldersExpanded] = useState(true)
  const [folderExpansions, setFolderExpansions] = useState<Record<string, boolean>>({})

  // Enforce: top-level folders only (no subfolders)
  const folderNodes = useMemo<FolderNode[]>(() => {
    return folders.map((f) => ({ ...f, children: [] }))
  }, [folders])

  const handleToggleExpand = (folderId: string) => {
    setFolderExpansions((prev) => ({
      ...prev,
      [folderId]: !prev[folderId],
    }))
  }

  return (
    <div className="mt-4">
      <div className="group px-2 py-1 flex items-center justify-between hover:bg-neutral-100/50 dark:hover:bg-neutral-800/50 rounded">
        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-4 w-4 p-0 hover:bg-neutral-200 dark:hover:bg-neutral-700"
            style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
            onClick={() => setFoldersExpanded(!foldersExpanded)}
          >
            {foldersExpanded ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
          </Button>
          <div className="text-xs font-medium text-neutral-500 dark:text-neutral-400 uppercase tracking-wider">
            Folders
          </div>
        </div>
        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-5 w-5 p-0 hover:bg-neutral-200 dark:hover:bg-neutral-700"
            style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
            onClick={onCreateFolder}
          >
            <Plus size={10} />
          </Button>
        </div>
      </div>

      {foldersExpanded && (
        <div className="mt-0.5 min-w-fit">
          {isLoading ? (
            <div className="px-2 py-2 text-xs text-neutral-500 dark:text-neutral-400">Loading folders...</div>
          ) : error ? (
            <div className="px-2 py-2 text-xs text-red-500">Failed to load folders</div>
          ) : folderNodes.length === 0 ? (
            <div className="px-2 py-2 text-xs text-neutral-500 dark:text-neutral-400">No folders yet</div>
          ) : (
            <FolderTreeView
              folders={folderNodes}
              activeFolderId={activeFolderId}
              onFolderClick={onFolderClick}
              onToggleExpand={handleToggleExpand}
              folderExpansions={folderExpansions}
            />
          )}
        </div>
      )}
    </div>
  )
}
